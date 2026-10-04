const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function makeCode() {
  return crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();
}

/* =========================
   DATABASE
========================= */

async function initDatabase() {
  console.log("⏳ Database qopheessaa...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exams (
      id SERIAL PRIMARY KEY
    )
  `);

  const examColumns = [
    ["teacher_name", "TEXT"],
    ["title", "TEXT"],
    ["subject", "TEXT"],
    ["grade", "TEXT"],
    ["duration", "INTEGER DEFAULT 30"],
    ["code", "TEXT"],
    ["exam_code", "TEXT"],
    ["creator_id", "INTEGER"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ];

  for (const [name, type] of examColumns) {
    await pool.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS ${name} ${type}
    `);
  }

  /* creator_id nullable godhi */
  await pool.query(`
    ALTER TABLE exams
    ALTER COLUMN creator_id DROP NOT NULL
  `);

  /* code duraan jiru yoo jiraate sirreessi */
  await pool.query(`
    UPDATE exams
    SET code = UPPER(
      SUBSTRING(
        MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT)
        FROM 1 FOR 8
      )
    )
    WHERE code IS NULL OR TRIM(code) = ''
  `);

  await pool.query(`
    UPDATE exams
    SET exam_code = code
    WHERE exam_code IS NULL OR TRIM(exam_code) = ''
  `);

  /* code unique */
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS exams_code_unique
    ON exams(code)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS exams_exam_code_unique
    ON exams(exam_code)
  `);

  /* =========================
     QUESTIONS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER,
      question_text TEXT,
      question TEXT,
      type TEXT DEFAULT 'multiple',
      option_a TEXT,
      option_b TEXT,
      option_c TEXT,
      option_d TEXT,
      correct_answer TEXT,
      points NUMERIC DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const questionColumns = [
    ["exam_id", "INTEGER"],
    ["question_text", "TEXT"],
    ["question", "TEXT"],
    ["type", "TEXT DEFAULT 'multiple'"],
    ["option_a", "TEXT"],
    ["option_b", "TEXT"],
    ["option_c", "TEXT"],
    ["option_d", "TEXT"],
    ["correct_answer", "TEXT"],
    ["points", "NUMERIC DEFAULT 1"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ];

  for (const [name, type] of questionColumns) {
    await pool.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS ${name} ${type}
    `);
  }

  await pool.query(`
    UPDATE questions
    SET question_text = question
    WHERE
      (question_text IS NULL OR TRIM(question_text) = '')
      AND question IS NOT NULL
  `);

  await pool.query(`
    UPDATE questions
    SET question = question_text
    WHERE
      (question IS NULL OR TRIM(question) = '')
      AND question_text IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS questions_exam_id_idx
    ON questions(exam_id)
  `);

  /* FK yoo hin jirre rakkaa hin godhin */
  try {
    await pool.query(`
      ALTER TABLE questions
      ADD CONSTRAINT questions_exam_fk
      FOREIGN KEY (exam_id)
      REFERENCES exams(id)
      ON DELETE CASCADE
    `);
  } catch (e) {
    if (!String(e.message).includes("already exists")) {
      console.log(
        "ℹ️ Question FK duraan jira ykn hin dabalamin:",
        e.message
      );
    }
  }

  /* =========================
     RESULTS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      score NUMERIC DEFAULT 0,
      total NUMERIC DEFAULT 0,
      percentage NUMERIC DEFAULT 0,
      answers JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const resultColumns = [
    ["exam_id", "INTEGER"],
    ["student_name", "TEXT"],
    ["score", "NUMERIC DEFAULT 0"],
    ["total", "NUMERIC DEFAULT 0"],
    ["percentage", "NUMERIC DEFAULT 0"],
    ["answers", "JSONB DEFAULT '{}'::jsonb"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ];

  for (const [name, type] of resultColumns) {
    await pool.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS ${name} ${type}
    `);
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS results_exam_id_idx
    ON results(exam_id)
  `);

  console.log("✅ Database migrations completed.");
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      status: "OK",
      database: "connected",
      app: "Hidaayatul-Bayaan"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      database: "error",
      error: error.message
    });
  }
});

/* =========================
   CREATE EXAM
========================= */

app.post("/api/exams", async (req, res) => {
  try {
    const teacherName =
      req.body.teacher_name ||
      req.body.teacherName ||
      "";

    const title =
      req.body.title ||
      req.body.examTitle ||
      "";

    const subject =
      req.body.subject ||
      req.body.examSubject ||
      "";

    const grade =
      req.body.grade ||
      req.body.examGrade ||
      "";

    const duration =
      Number(
        req.body.duration ||
        req.body.examDuration ||
        30
      ) || 30;

    if (!teacherName.trim()) {
      return res.status(400).json({
        error: "Maqaan barsiisaa barbaachisa."
      });
    }

    if (!title.trim()) {
      return res.status(400).json({
        error: "Maqaan qormaataa barbaachisa."
      });
    }

    const code = makeCode();

    const result = await pool.query(
      `
      INSERT INTO exams
      (
        teacher_name,
        title,
        subject,
        grade,
        duration,
        code,
        exam_code,
        creator_id
      )
      VALUES
      ($1, $2, $3, $4, $5, $6, $6, NULL)
      RETURNING *
      `,
      [
        teacherName.trim(),
        title.trim(),
        subject.trim(),
        grade.trim(),
        duration,
        code
      ]
    );

    const exam = result.rows[0];

    res.json({
      success: true,
      exam: {
        id: exam.id,
        teacher_name: exam.teacher_name,
        title: exam.title,
        subject: exam.subject,
        grade: exam.grade,
        duration: exam.duration,
        code: exam.code,
        exam_code: exam.exam_code
      },
      link:
        `${req.protocol}://${req.get("host")}/?exam=${exam.code}`
    });

  } catch (error) {
    console.error("Create exam error:", error);

    res.status(500).json({
      error: "Qormaata uumuu irratti rakkoon uumame."
    });
  }
});

/* =========================
   GET EXAM BY CODE
========================= */

app.get("/api/exams/code/:code", async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();

    const result = await pool.query(
      `
      SELECT
        id,
        teacher_name,
        title,
        subject,
        grade,
        duration,
        code,
        exam_code,
        created_at
      FROM exams
      WHERE UPPER(code) = $1
         OR UPPER(exam_code) = $1
      LIMIT 1
      `,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Qormaanni koodii kana qabu hin argamne."
      });
    }

    const exam = result.rows[0];

    res.json({
      success: true,
      exam
    });

  } catch (error) {
    console.error("Get exam error:", error);

    res.status(500).json({
      error: "Qormaata barbaaduu irratti rakkoon uumame."
    });
  }
});

/* =========================
   ADD QUESTION
========================= */

app.post("/api/exams/:id/questions", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const question =
      req.body.question ||
      req.body.question_text ||
      "";

    const type =
      req.body.type ||
      "multiple";

    const optionA =
      req.body.option_a || "";

    const optionB =
      req.body.option_b || "";

    const optionC =
      req.body.option_c || "";

    const optionD =
      req.body.option_d || "";

    const correctAnswer =
      req.body.correct_answer ||
      "";

    const points =
      Number(req.body.points) || 1;

    if (!question.trim()) {
      return res.status(400).json({
        error: "Gaaffiin barbaachisa."
      });
    }

    const exam = await pool.query(
      `
      SELECT id
      FROM exams
      WHERE id = $1
      `,
      [examId]
    );

    if (exam.rows.length === 0) {
      return res.status(404).json({
        error: "Qormaanni hin argamne."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO questions
      (
        exam_id,
        question_text,
        question,
        type,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_answer,
        points
      )
      VALUES
      ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        examId,
        question.trim(),
        type,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAnswer,
        points
      ]
    );

    res.json({
      success: true,
      question: result.rows[0]
    });

  } catch (error) {
    console.error("Add question error:", error);

    res.status(500).json({
      error: "Gaaffii dabalu irratti rakkoon uumame."
    });
  }
});

/* =========================
   GET QUESTIONS
   CORRECT ANSWER HIN MUL'ATU
========================= */

app.get("/api/exams/:id/questions", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const result = await pool.query(
      `
      SELECT
        id,
        exam_id,
        COALESCE(question_text, question) AS question,
        type,
        option_a,
        option_b,
        option_c,
        option_d,
        points,
        created_at
      FROM questions
      WHERE exam_id = $1
      ORDER BY id ASC
      `,
      [examId]
    );

    res.json({
      success: true,
      questions: result.rows
    });

  } catch (error) {
    console.error("Get questions error:", error);

    res.status(500).json({
      error: "Gaaffilee argachuu hin dandeenye."
    });
  }
});

/* =========================
   DELETE QUESTION
========================= */

app.delete("/api/questions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await pool.query(
      `
      DELETE FROM questions
      WHERE id = $1
      `,
      [id]
    );

    res.json({
      success: true,
      message: "Gaaffiin haqameera."
    });

  } catch (error) {
    console.error("Delete question error:", error);

    res.status(500).json({
      error: "Gaaffii haquu hin dandeenye."
    });
  }
});

/* =========================
   SUBMIT EXAM
   BARATAA BU'AA HIN ARGU
========================= */

app.post("/api/exams/:id/submit", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const studentName =
      req.body.student_name ||
      "";

    const answers =
      req.body.answers ||
      {};

    if (!studentName.trim()) {
      return res.status(400).json({
        error: "Maqaan barataa barbaachisa."
      });
    }

    const examResult = await pool.query(
      `
      SELECT id
      FROM exams
      WHERE id = $1
      `,
      [examId]
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({
        error: "Qormaanni hin argamne."
      });
    }

    const questionsResult = await pool.query(
      `
      SELECT
        id,
        COALESCE(question_text, question) AS question,
        type,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_answer,
        points
      FROM questions
      WHERE exam_id = $1
      ORDER BY id ASC
      `,
      [examId]
    );

    const questions = questionsResult.rows;

    let score = 0;
    let total = 0;
    let correct = 0;
    let wrong = 0;
    let unanswered = 0;

    const details = [];

    for (const q of questions) {
      const points = Number(q.points) || 1;

      total += points;

      const studentAnswer =
        answers[q.id] !== undefined
          ? String(answers[q.id]).trim()
          : "";

      const correctAnswer =
        q.correct_answer !== null &&
        q.correct_answer !== undefined
          ? String(q.correct_answer).trim()
          : "";

      if (!studentAnswer) {
        unanswered++;

        details.push({
          question_id: q.id,
          question: q.question,
          student_answer: "",
          correct_answer: correctAnswer,
          status: "unanswered",
          points: 0
        });

        continue;
      }

      if (
        studentAnswer.toLowerCase() ===
        correctAnswer.toLowerCase()
      ) {
        score += points;
        correct++;

        details.push({
          question_id: q.id,
          question: q.question,
          student_answer: studentAnswer,
          correct_answer: correctAnswer,
          status: "correct",
          points
        });

      } else {
        wrong++;

        details.push({
          question_id: q.id,
          question: q.question,
          student_answer: studentAnswer,
          correct_answer: correctAnswer,
          status: "wrong",
          points: 0
        });
      }
    }

    const percentage =
      total > 0
        ? Number(((score / total) * 100).toFixed(2))
        : 0;

    await pool.query(
      `
      INSERT INTO results
      (
        exam_id,
        student_name,
        score,
        total,
        percentage,
        answers
      )
      VALUES
      ($1,$2,$3,$4,$5,$6)
      `,
      [
        examId,
        studentName.trim(),
        score,
        total,
        percentage,
        JSON.stringify({
          answers,
          correct,
          wrong,
          unanswered,
          details
        })
      ]
    );

    /*
      BARATAA QABXII HIN ARGUTU.
      Odeeffannoo bu'aa server irraa hin deebifnu.
    */

    res.json({
      success: true,
      message:
        "Qormaanni kee sirriitti galmaa'eera."
    });

  } catch (error) {
    console.error("Submit exam error:", error);

    res.status(500).json({
      error:
        "Qormaata galmeessuu irratti rakkoon uumame."
    });
  }
});

/* =========================
   TEACHER RESULTS
========================= */

app.get("/api/exams/:id/results", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const examResult = await pool.query(
      `
      SELECT
        id,
        teacher_name,
        title,
        subject,
        grade,
        duration,
        code,
        exam_code
      FROM exams
      WHERE id = $1
      `,
      [examId]
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({
        error: "Qormaanni hin argamne."
      });
    }

    const results = await pool.query(
      `
      SELECT
        id,
        student_name,
        score,
        total,
        percentage,
        answers,
        created_at
      FROM results
      WHERE exam_id = $1
      ORDER BY created_at DESC
      `,
      [examId]
    );

    const students = results.rows.map(row => {
      const data =
        row.answers || {};

      return {
        id: row.id,
        student_name: row.student_name,
        score: Number(row.score) || 0,
        total: Number(row.total) || 0,
        percentage: Number(row.percentage) || 0,
        correct: Number(data.correct) || 0,
        wrong: Number(data.wrong) || 0,
        unanswered: Number(data.unanswered) || 0,
        answers: data.answers || {},
        details: data.details || [],
        created_at: row.created_at
      };
    });

    res.json({
      success: true,
      exam: examResult.rows[0],
      results: students
    });

  } catch (error) {
    console.error("Results error:", error);

    res.status(500).json({
      error:
        "Bu'aa qormaataa argachuu irratti rakkoon uumame."
    });
  }
});

/* =========================
   API 404
========================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route hin argamne."
  });
});

/* =========================
   ERROR HANDLER
========================= */

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    error: "Server error."
  });
});

/* =========================
   START
========================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `🚀 Hidaayatul-Bayaan running on port ${PORT}`
        );
      }
    );

  } catch (error) {
    console.error(
      "❌ Database initialization failed:",
      error
    );

    process.exit(1);
  }
}

startServer();

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
  connectionTimeoutMillis: 15000
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   CODE GENERATOR
========================= */

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
  console.log("⏳ Hidaayatul-Bayaan database qopheessaa...");

  /*
    IMPORTANT:
    OR tables:
      exams
      questions
      results

    Hidaayatul-Bayaan tables:
      hb_exams
      hb_questions
      hb_results

    OR tables hin tuqaman.
  */

  /* =========================
     HB EXAMS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hb_exams (
      id SERIAL PRIMARY KEY,
      teacher_name TEXT NOT NULL,
      title TEXT NOT NULL,
      subject TEXT DEFAULT '',
      grade TEXT DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 30,
      code TEXT UNIQUE NOT NULL,
      exam_code TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS hb_exams_code_idx
    ON hb_exams(code)
  `);

  /* =========================
     HB QUESTIONS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hb_questions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL,
      question_text TEXT,
      question TEXT,
      type TEXT DEFAULT 'multiple',
      option_a TEXT,
      option_b TEXT,
      option_c TEXT,
      option_d TEXT,
      correct_answer TEXT,
      points NUMERIC DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT hb_questions_exam_fk
        FOREIGN KEY (exam_id)
        REFERENCES hb_exams(id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS hb_questions_exam_id_idx
    ON hb_questions(exam_id)
  `);

  /* =========================
     HB RESULTS
  ========================= */

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hb_results (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      score NUMERIC DEFAULT 0,
      total NUMERIC DEFAULT 0,
      percentage NUMERIC DEFAULT 0,
      answers JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT hb_results_exam_fk
        FOREIGN KEY (exam_id)
        REFERENCES hb_exams(id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS hb_results_exam_id_idx
    ON hb_results(exam_id)
  `);

  console.log("✅ Hidaayatul-Bayaan database qophaa'eera.");
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
    console.error("Health error:", error);

    res.status(500).json({
      success: false,
      status: "ERROR",
      database: "error",
      error: error.message
    });
  }
});

/* =========================
   STATUS
========================= */

app.get("/api/status", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM hb_exams) AS exams,
        (SELECT COUNT(*) FROM hb_questions) AS questions,
        (SELECT COUNT(*) FROM hb_results) AS results
    `);

    res.json({
      success: true,
      app: "Hidaayatul-Bayaan",
      database: "connected",
      tables: {
        exams: Number(result.rows[0].exams),
        questions: Number(result.rows[0].questions),
        results: Number(result.rows[0].results)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
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
      INSERT INTO hb_exams
      (
        teacher_name,
        title,
        subject,
        grade,
        duration,
        code,
        exam_code
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$6)
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
    const code =
      String(req.params.code || "")
        .trim()
        .toUpperCase();

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
      FROM hb_exams
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

    res.json({
      success: true,
      exam: result.rows[0]
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

    if (!Number.isInteger(examId)) {
      return res.status(400).json({
        error: "Exam ID sirrii miti."
      });
    }

    const question =
      req.body.question ||
      req.body.question_text ||
      "";

    const type =
      req.body.type ||
      "multiple";

    const optionA =
      req.body.option_a ||
      "";

    const optionB =
      req.body.option_b ||
      "";

    const optionC =
      req.body.option_c ||
      "";

    const optionD =
      req.body.option_d ||
      "";

    const correctAnswer =
      req.body.correct_answer ||
      req.body.correctAnswer ||
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
      FROM hb_exams
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
      INSERT INTO hb_questions
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
      FROM hb_questions
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

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        error: "Question ID sirrii miti."
      });
    }

    const result = await pool.query(
      `
      DELETE FROM hb_questions
      WHERE id = $1
      `,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Gaaffiin hin argamne."
      });
    }

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
      req.body.studentName ||
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
      FROM hb_exams
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
      FROM hb_questions
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
      INSERT INTO hb_results
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
      FROM hb_exams
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
      FROM hb_results
      WHERE exam_id = $1
      ORDER BY created_at DESC
      `,
      [examId]
    );

    const students = results.rows.map(row => {
      const data = row.answers || {};

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
   DELETE EXAM
========================= */

app.delete("/api/exams/:id", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM hb_exams
      WHERE id = $1
      `,
      [examId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Qormaanni hin argamne."
      });
    }

    res.json({
      success: true,
      message: "Qormaanni haqameera."
    });

  } catch (error) {
    console.error("Delete exam error:", error);

    res.status(500).json({
      error: "Qormaata haquu hin dandeenye."
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

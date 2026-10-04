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

// =========================
// MIDDLEWARE
// =========================

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// =========================
// HELPERS
// =========================

function makeCode(length = 6) {
  return crypto
    .randomBytes(10)
    .toString("hex")
    .toUpperCase()
    .slice(0, length);
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// =========================
// DATABASE INITIALIZATION
// =========================

async function initDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // =========================
    // EXAMS TABLE
    // =========================

    await client.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id SERIAL PRIMARY KEY
      )
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS teacher_name TEXT
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS title TEXT
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS subject TEXT
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS grade TEXT
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 30
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS code TEXT
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS exam_code TEXT
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS creator_id INTEGER
    `);

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    // creator_id NULL ta'uu danda'a
    await client.query(`
      ALTER TABLE exams
      ALTER COLUMN creator_id DROP NOT NULL
    `).catch(() => {});

    // code NULL ta'eef generated code
    const oldExams = await client.query(`
      SELECT id
      FROM exams
      WHERE code IS NULL OR TRIM(code) = ''
    `);

    for (const row of oldExams.rows) {
      let code = makeCode();

      while (true) {
        const check = await client.query(
          `SELECT id FROM exams WHERE code = $1 OR exam_code = $1 LIMIT 1`,
          [code]
        );

        if (check.rowCount === 0) break;

        code = makeCode();
      }

      await client.query(
        `
        UPDATE exams
        SET code = $1
        WHERE id = $2
        `,
        [code, row.id]
      );
    }

    // exam_code yoo hin jirre code irraa guuti
    await client.query(`
      UPDATE exams
      SET exam_code = code
      WHERE exam_code IS NULL OR TRIM(exam_code) = ''
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS exams_code_unique_idx
      ON exams(code)
      WHERE code IS NOT NULL
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS exams_exam_code_unique_idx
      ON exams(exam_code)
      WHERE exam_code IS NOT NULL
    `);

    // =========================
    // QUESTIONS TABLE
    // =========================

    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        exam_id INTEGER,
        question_text TEXT,
        question TEXT,
        type TEXT DEFAULT 'multiple',
        option_a TEXT DEFAULT '',
        option_b TEXT DEFAULT '',
        option_c TEXT DEFAULT '',
        option_d TEXT DEFAULT '',
        correct_answer TEXT,
        points NUMERIC DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS exam_id INTEGER
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS question_text TEXT
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS question TEXT
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'multiple'
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS option_a TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS option_b TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS option_c TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS option_d TEXT DEFAULT ''
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS correct_answer TEXT
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS points NUMERIC DEFAULT 1
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    // Old question column irraa question_text guuti
    await client.query(`
      UPDATE questions
      SET question_text = question
      WHERE
        (question_text IS NULL OR TRIM(question_text) = '')
        AND question IS NOT NULL
        AND TRIM(question) <> ''
    `);

    // question_text irraa question guuti
    await client.query(`
      UPDATE questions
      SET question = question_text
      WHERE
        (question IS NULL OR TRIM(question) = '')
        AND question_text IS NOT NULL
        AND TRIM(question_text) <> ''
    `);

    // Existing DB keessatti question_text NOT NULL yoo ta'e
    // gaaffii duraanii hin qabne rows irratti rakkoo hin fida.
    // Insert haaraan yeroo hunda question_text guuta.

    await client.query(`
      CREATE INDEX IF NOT EXISTS questions_exam_id_idx
      ON questions(exam_id)
    `);

    // Foreign key yoo hin jirre dabali
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'questions_exam_id_fkey'
        ) THEN
          ALTER TABLE questions
          ADD CONSTRAINT questions_exam_id_fkey
          FOREIGN KEY (exam_id)
          REFERENCES exams(id)
          ON DELETE CASCADE;
        END IF;
      END
      $$;
    `).catch(() => {});

    // =========================
    // RESULTS TABLE
    // =========================

    await client.query(`
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

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS exam_id INTEGER
    `);

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS student_name TEXT
    `);

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS score NUMERIC DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS percentage NUMERIC DEFAULT 0
    `);

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}'::jsonb
    `);

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS results_exam_id_idx
      ON results(exam_id)
    `);

    await client.query("COMMIT");

    console.log("✅ Database migrations completed.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Database initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
}

// =========================
// HOME
// =========================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =========================
// HEALTH
// =========================

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
      status: "ERROR",
      database: "disconnected",
      error: error.message
    });
  }
});

// =========================
// CREATE EXAM
// =========================

app.post("/api/exams", async (req, res) => {
  const {
    teacher_name,
    teacherName,
    title,
    subject,
    grade,
    duration
  } = req.body;

  const teacher = String(
    teacher_name || teacherName || ""
  ).trim();

  const examTitle = String(title || "").trim();
  const examSubject = String(subject || "").trim();
  const examGrade = String(grade || "").trim();

  const examDuration = Math.max(
    1,
    numberValue(duration, 30)
  );

  if (!teacher) {
    return res.status(400).json({
      success: false,
      error: "Maqaa barsiisaa galchi."
    });
  }

  if (!examTitle) {
    return res.status(400).json({
      success: false,
      error: "Mata-duree qormaataa galchi."
    });
  }

  let code = makeCode();

  try {
    while (true) {
      const check = await pool.query(
        `
        SELECT id
        FROM exams
        WHERE code = $1 OR exam_code = $1
        LIMIT 1
        `,
        [code]
      );

      if (check.rowCount === 0) break;

      code = makeCode();
    }

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
      ($1,$2,$3,$4,$5,$6,$6,NULL)
      RETURNING
        id,
        teacher_name,
        title,
        subject,
        grade,
        duration,
        code,
        exam_code,
        created_at
      `,
      [
        teacher,
        examTitle,
        examSubject,
        examGrade,
        examDuration,
        code
      ]
    );

    const exam = result.rows[0];

    const baseUrl =
      `${req.protocol}://${req.get("host")}`;

    const link =
      `${baseUrl}/?exam=${encodeURIComponent(exam.code)}`;

    res.json({
      success: true,
      exam,
      link
    });
  } catch (error) {
    console.error("CREATE EXAM ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// GET EXAM BY CODE
// =========================

app.get("/api/exams/code/:code", async (req, res) => {
  const code = String(req.params.code || "")
    .trim()
    .toUpperCase();

  try {
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
      WHERE
        UPPER(code) = $1
        OR UPPER(exam_code) = $1
      LIMIT 1
      `,
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Qormaanni code kanaan hin argamne."
      });
    }

    res.json({
      success: true,
      exam: result.rows[0]
    });
  } catch (error) {
    console.error("GET EXAM ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// ADD QUESTION
// =========================

app.post("/api/exams/:id/questions", async (req, res) => {
  const examId = Number(req.params.id);

  const {
    question,
    question_text,
    type = "multiple",
    option_a = "",
    option_b = "",
    option_c = "",
    option_d = "",
    correct_answer,
    points = 1
  } = req.body;

  const questionText = String(
    question_text || question || ""
  ).trim();

  const answer = String(
    correct_answer || ""
  ).trim();

  if (!Number.isInteger(examId)) {
    return res.status(400).json({
      success: false,
      error: "Exam ID sirrii miti."
    });
  }

  if (!questionText) {
    return res.status(400).json({
      success: false,
      error: "Gaaffii galchi."
    });
  }

  if (!answer) {
    return res.status(400).json({
      success: false,
      error: "Deebii sirrii filadhu."
    });
  }

  try {
    const examCheck = await pool.query(
      `
      SELECT id
      FROM exams
      WHERE id = $1
      `,
      [examId]
    );

    if (examCheck.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Qormaanni hin argamne."
      });
    }

    const pointsValue = Math.max(
      1,
      numberValue(points, 1)
    );

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
        questionText,
        type,
        option_a,
        option_b,
        option_c,
        option_d,
        answer,
        pointsValue
      ]
    );

    res.json({
      success: true,
      question: result.rows[0]
    });
  } catch (error) {
    console.error("ADD QUESTION ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// GET QUESTIONS
// =========================

app.get("/api/exams/:id/questions", async (req, res) => {
  const examId = Number(req.params.id);

  try {
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
        points
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
    console.error("GET QUESTIONS ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// DELETE QUESTION
// =========================

app.delete("/api/questions/:id", async (req, res) => {
  const questionId = Number(req.params.id);

  try {
    const result = await pool.query(
      `
      DELETE FROM questions
      WHERE id = $1
      RETURNING id
      `,
      [questionId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Gaaffiin hin argamne."
      });
    }

    res.json({
      success: true,
      message: "Gaaffiin haqame."
    });
  } catch (error) {
    console.error("DELETE QUESTION ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// SUBMIT EXAM
// =========================

app.post("/api/exams/:id/submit", async (req, res) => {
  const examId = Number(req.params.id);

  const {
    student_name,
    studentName,
    answers = {}
  } = req.body;

  const student = String(
    student_name || studentName || ""
  ).trim();

  if (!student) {
    return res.status(400).json({
      success: false,
      error: "Maqaa barataa galchi."
    });
  }

  try {
    const questionsResult = await pool.query(
      `
      SELECT
        id,
        question_text,
        question,
        correct_answer,
        points
      FROM questions
      WHERE exam_id = $1
      ORDER BY id ASC
      `,
      [examId]
    );

    const questions = questionsResult.rows;

    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Qormaata kana keessatti gaaffiin hin jiru."
      });
    }

    let score = 0;
    let total = 0;
    let correct = 0;
    let wrong = 0;
    let unanswered = 0;

    const details = [];

    for (const q of questions) {
      const points = numberValue(q.points, 1);

      total += points;

      const studentAnswer =
        answers[q.id] !== undefined &&
        answers[q.id] !== null
          ? String(answers[q.id]).trim()
          : "";

      const correctAnswer =
        String(q.correct_answer || "").trim();

      let status = "unanswered";

      if (!studentAnswer) {
        unanswered++;
      } else if (
        studentAnswer.toLowerCase() ===
        correctAnswer.toLowerCase()
      ) {
        score += points;
        correct++;
        status = "correct";
      } else {
        wrong++;
        status = "wrong";
      }

      details.push({
        question_id: q.id,
        question: q.question_text || q.question || "",
        student_answer: studentAnswer,
        correct_answer: correctAnswer,
        points,
        status
      });
    }

    const percentage =
      total > 0
        ? Number(((score / total) * 100).toFixed(2))
        : 0;

    const result = await pool.query(
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
      RETURNING id, created_at
      `,
      [
        examId,
        student,
        score,
        total,
        percentage,
        JSON.stringify(answers)
      ]
    );

    res.json({
      success: true,
      result_id: result.rows[0].id,
      student_name: student,
      score,
      total,
      percentage,
      correct,
      wrong,
      unanswered,
      details,
      submitted_at: result.rows[0].created_at
    });
  } catch (error) {
    console.error("SUBMIT EXAM ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// TEACHER RESULTS
// =========================

app.get("/api/exams/:id/results", async (req, res) => {
  const examId = Number(req.params.id);

  try {
    const examResult = await pool.query(
      `
      SELECT
        id,
        teacher_name,
        title,
        subject,
        grade,
        duration,
        code
      FROM exams
      WHERE id = $1
      `,
      [examId]
    );

    if (examResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: "Qormaanni hin argamne."
      });
    }

    const questionsResult = await pool.query(
      `
      SELECT
        id,
        COALESCE(question_text, question) AS question,
        correct_answer,
        points
      FROM questions
      WHERE exam_id = $1
      ORDER BY id ASC
      `,
      [examId]
    );

    const resultsResult = await pool.query(
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

    const questions = questionsResult.rows;

    const results = resultsResult.rows.map((r) => {
      const answers =
        r.answers && typeof r.answers === "object"
          ? r.answers
          : {};

      let correct = 0;
      let wrong = 0;
      let unanswered = 0;

      const details = questions.map((q) => {
        const studentAnswer =
          answers[q.id] !== undefined &&
          answers[q.id] !== null
            ? String(answers[q.id]).trim()
            : "";

        const correctAnswer =
          String(q.correct_answer || "").trim();

        let status = "unanswered";

        if (!studentAnswer) {
          unanswered++;
        } else if (
          studentAnswer.toLowerCase() ===
          correctAnswer.toLowerCase()
        ) {
          correct++;
          status = "correct";
        } else {
          wrong++;
          status = "wrong";
        }

        return {
          question_id: q.id,
          question: q.question,
          student_answer: studentAnswer,
          correct_answer: correctAnswer,
          points: q.points,
          status
        };
      });

      return {
        id: r.id,
        student_name: r.student_name,
        score: numberValue(r.score),
        total: numberValue(r.total),
        percentage: numberValue(r.percentage),
        correct,
        wrong,
        unanswered,
        created_at: r.created_at,
        details
      };
    });

    res.json({
      success: true,
      exam: examResult.rows[0],
      results
    });
  } catch (error) {
    console.error("GET RESULTS ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =========================
// API 404
// =========================

app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    error: "API route hin argamne."
  });
});

// =========================
// ERROR HANDLER
// =========================

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);

  res.status(500).json({
    success: false,
    error: error.message || "Server error"
  });
});

// =========================
// START SERVER
// =========================

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `🚀 Hidaayatul-Bayaan server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error("❌ Server start failed:", error);
    process.exit(1);
  }
}

startServer();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   DATABASE
========================= */

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL hin argamne.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000
});

/* =========================
   APP
========================= */

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   CODE
========================= */

function makeCode(length = 8) {
  return crypto
    .randomBytes(10)
    .toString("hex")
    .slice(0, length)
    .toUpperCase();
}

/* =========================
   DATABASE TABLES
========================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exams (
      id SERIAL PRIMARY KEY,
      teacher_name TEXT NOT NULL,
      title TEXT NOT NULL,
      subject TEXT DEFAULT '',
      grade TEXT DEFAULT '',
      duration INTEGER DEFAULT 30,
      exam_code VARCHAR(20) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      type TEXT DEFAULT 'multiple',
      option_a TEXT DEFAULT '',
      option_b TEXT DEFAULT '',
      option_c TEXT DEFAULT '',
      option_d TEXT DEFAULT '',
      correct_answer TEXT NOT NULL,
      points INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      percentage INTEGER DEFAULT 0,
      answers JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_questions_exam_id
      ON questions(exam_id);

    CREATE INDEX IF NOT EXISTS idx_results_exam_id
      ON results(exam_id);

    CREATE INDEX IF NOT EXISTS idx_exams_exam_code
      ON exams(exam_code);
  `);

  console.log("✅ Database tables ready.");
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
      ok: true,
      app: "Hidaayatul-Bayaan",
      database: "PostgreSQL connected"
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      ok: false,
      database: "Database connection failed",
      error: error.message
    });
  }
});

/* =========================
   CREATE EXAM
========================= */

app.post("/api/exams", async (req, res) => {
  try {
    const {
      teacher_name,
      title,
      subject,
      grade,
      duration
    } = req.body;

    if (!teacher_name || !title) {
      return res.status(400).json({
        error: "Maqaa barsiisaa fi maqaa qormaataa guuti."
      });
    }

    let exam = null;
    let lastError = null;

    for (let i = 0; i < 5; i++) {
      const exam_code = makeCode();

      try {
        const result = await pool.query(
          `
          INSERT INTO exams
          (
            teacher_name,
            title,
            subject,
            grade,
            duration,
            exam_code
          )
          VALUES ($1,$2,$3,$4,$5,$6)
          RETURNING *
          `,
          [
            teacher_name,
            title,
            subject || "",
            grade || "",
            Number(duration) || 30,
            exam_code
          ]
        );

        exam = result.rows[0];
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!exam) {
      return res.status(500).json({
        error:
          lastError?.message ||
          "Qormaata uumuu hin dandeenye."
      });
    }

    res.json({
      success: true,
      exam
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   ADD QUESTION
========================= */

app.post("/api/exams/:id/questions", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const {
      question,
      type,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_answer,
      points
    } = req.body;

    if (!question || !correct_answer) {
      return res.status(400).json({
        error: "Gaaffii fi deebii sirrii guuti."
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

    const result = await pool.query(
      `
      INSERT INTO questions
      (
        exam_id,
        question,
        type,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_answer,
        points
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        examId,
        question,
        type || "multiple",
        option_a || "",
        option_b || "",
        option_c || "",
        option_d || "",
        correct_answer,
        Number(points) || 1
      ]
    );

    res.json({
      success: true,
      question: result.rows[0]
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   GET EXAM BY CODE
   Correct answer hin ergisiisu
========================= */

app.get("/api/exams/code/:code", async (req, res) => {
  try {
    const code = req.params.code
      .trim()
      .toUpperCase();

    const examResult = await pool.query(
      `
      SELECT *
      FROM exams
      WHERE exam_code = $1
      `,
      [code]
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({
        error: "Qormaata kana hin arganne."
      });
    }

    const exam = examResult.rows[0];

    const questionsResult = await pool.query(
      `
      SELECT
        id,
        question,
        type,
        option_a,
        option_b,
        option_c,
        option_d,
        points
      FROM questions
      WHERE exam_id = $1
      ORDER BY created_at ASC
      `,
      [exam.id]
    );

    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        grade: exam.grade,
        duration: exam.duration,
        exam_code: exam.exam_code,
        teacher_name: exam.teacher_name
      },
      questions: questionsResult.rows
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   QUESTIONS
========================= */

app.get("/api/exams/:id/questions", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const result = await pool.query(
      `
      SELECT *
      FROM questions
      WHERE exam_id = $1
      ORDER BY created_at ASC
      `,
      [examId]
    );

    res.json({
      questions: result.rows
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   SUBMIT EXAM
========================= */

app.post("/api/exams/:id/submit", async (req, res) => {
  try {
    const examId = Number(req.params.id);

    const {
      student_name,
      answers
    } = req.body;

    if (!student_name) {
      return res.status(400).json({
        error: "Maqaa barataa galchi."
      });
    }

    const examResult = await pool.query(
      `
      SELECT *
      FROM exams
      WHERE id = $1
      `,
      [examId]
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({
        error: "Qormaata hin argamne."
      });
    }

    const questionsResult = await pool.query(
      `
      SELECT *
      FROM questions
      WHERE exam_id = $1
      ORDER BY created_at ASC
      `,
      [examId]
    );

    const questions = questionsResult.rows;

    let score = 0;
    let total = 0;

    for (const q of questions) {
      const points = Number(q.points || 1);

      total += points;

      const userAnswer =
        answers && answers[q.id]
          ? String(answers[q.id])
              .trim()
              .toLowerCase()
          : "";

      const correctAnswer =
        String(q.correct_answer || "")
          .trim()
          .toLowerCase();

      if (
        userAnswer &&
        userAnswer === correctAnswer
      ) {
        score += points;
      }
    }

    const percentage =
      total > 0
        ? Math.round((score / total) * 100)
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
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        examId,
        student_name,
        score,
        total,
        percentage,
        JSON.stringify(answers || {})
      ]
    );

    const saved = result.rows[0];

    res.json({
      success: true,
      result: {
        id: saved.id,
        student_name,
        score,
        total,
        percentage
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
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
        title,
        subject,
        grade,
        duration,
        exam_code,
        teacher_name
      FROM exams
      WHERE id = $1
      `,
      [examId]
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({
        error: "Qormaata hin argamne."
      });
    }

    const exam = examResult.rows[0];

    const questionsResult = await pool.query(
      `
      SELECT *
      FROM questions
      WHERE exam_id = $1
      ORDER BY created_at ASC
      `,
      [examId]
    );

    const resultsResult = await pool.query(
      `
      SELECT *
      FROM results
      WHERE exam_id = $1
      ORDER BY created_at DESC
      `,
      [examId]
    );

    const questions = questionsResult.rows;
    const results = resultsResult.rows;

    const students = results.map((result) => {
      const answers = result.answers || {};

      let correctCount = 0;
      let wrongCount = 0;
      let unansweredCount = 0;

      const details = questions.map((q, index) => {
        const studentAnswer =
          answers[q.id] !== undefined
            ? String(answers[q.id])
            : "";

        const correctAnswer =
          String(q.correct_answer || "");

        let status = "unanswered";

        if (!studentAnswer.trim()) {
          unansweredCount++;
          status = "unanswered";
        } else if (
          studentAnswer
            .trim()
            .toLowerCase() ===
          correctAnswer
            .trim()
            .toLowerCase()
        ) {
          correctCount++;
          status = "correct";
        } else {
          wrongCount++;
          status = "wrong";
        }

        return {
          number: index + 1,
          question: q.question,
          student_answer: studentAnswer,
          correct_answer: correctAnswer,
          points: Number(q.points || 1),
          status
        };
      });

      return {
        id: result.id,
        student_name: result.student_name,
        score: Number(result.score || 0),
        total: Number(result.total || 0),
        percentage: Number(result.percentage || 0),
        created_at: result.created_at,
        correct_count: correctCount,
        wrong_count: wrongCount,
        unanswered_count: unansweredCount,
        details
      };
    });

    res.json({
      exam,
      students
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   DELETE QUESTION
========================= */

app.delete("/api/questions/:id", async (req, res) => {
  try {
    const questionId = Number(req.params.id);

    const result = await pool.query(
      `
      DELETE FROM questions
      WHERE id = $1
      RETURNING id
      `,
      [questionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Gaaffiin hin argamne."
      });
    }

    res.json({
      success: true
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   SERVER START
========================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `✅ Hidaayatul-Bayaan server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "❌ Database initialization failed:",
      error.message
    );

    process.exit(1);
  }
}

startServer();

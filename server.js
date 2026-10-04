const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

/* =====================================================
   DATABASE
===================================================== */

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

/* =====================================================
   APP
===================================================== */

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =====================================================
   EXAM CODE
===================================================== */

function makeCode(length = 8) {
  return crypto
    .randomBytes(10)
    .toString("hex")
    .slice(0, length)
    .toUpperCase();
}

/* =====================================================
   DATABASE INITIALIZATION / MIGRATION
===================================================== */

async function initDatabase() {
  const client = await pool.connect();

  try {
    console.log("🔄 Database initialization started...");

    await client.query("BEGIN");

    /* =================================================
       EXAMS TABLE
    ================================================= */

    await client.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id SERIAL PRIMARY KEY
      )
    `);

    /*
      Existing database keessatti columns
      hafan hundaa dabala.
    */

    await client.query(`
      ALTER TABLE exams
      ADD COLUMN IF NOT EXISTS teacher_name TEXT,
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS subject TEXT,
      ADD COLUMN IF NOT EXISTS grade TEXT,
      ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 30,
      ADD COLUMN IF NOT EXISTS code TEXT,
      ADD COLUMN IF NOT EXISTS exam_code TEXT,
      ADD COLUMN IF NOT EXISTS creator_id INTEGER,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    /*
      creator_id appii keenya keessatti amma
      dirqama miti.
    */

    await client.query(`
      ALTER TABLE exams
      ALTER COLUMN creator_id DROP NOT NULL
    `);

    /*
      code fi exam_code duraan NULL yoo ta'an,
      code haaraa isaanii uuma.
    */

    const oldExams = await client.query(`
      SELECT id, code, exam_code
      FROM exams
      WHERE code IS NULL
         OR code = ''
         OR exam_code IS NULL
         OR exam_code = ''
    `);

    for (const row of oldExams.rows) {
      let code =
        row.code ||
        row.exam_code ||
        makeCode();

      let duplicate = await client.query(
        `
        SELECT id
        FROM exams
        WHERE (code = $1 OR exam_code = $1)
          AND id <> $2
        LIMIT 1
        `,
        [code, row.id]
      );

      while (duplicate.rows.length > 0) {
        code = makeCode();

        duplicate = await client.query(
          `
          SELECT id
          FROM exams
          WHERE (code = $1 OR exam_code = $1)
            AND id <> $2
          LIMIT 1
          `,
          [code, row.id]
        );
      }

      await client.query(
        `
        UPDATE exams
        SET
          code = $1,
          exam_code = $1
        WHERE id = $2
        `,
        [code, row.id]
      );
    }

    /*
      Existing code column yoo NOT NULL ta'e,
      qormaata haaraan code kennama.
    */

    /* =================================================
       QUESTIONS TABLE
    ================================================= */

    await client.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY
      )
    `);

    await client.query(`
      ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS exam_id INTEGER,
      ADD COLUMN IF NOT EXISTS question TEXT,
      ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'multiple',
      ADD COLUMN IF NOT EXISTS option_a TEXT,
      ADD COLUMN IF NOT EXISTS option_b TEXT,
      ADD COLUMN IF NOT EXISTS option_c TEXT,
      ADD COLUMN IF NOT EXISTS option_d TEXT,
      ADD COLUMN IF NOT EXISTS correct_answer TEXT,
      ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    /*
      Foreign key questions -> exams
    */

    const questionFK =
      await client.query(`
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'questions_exam_id_fkey'
      `);

    if (questionFK.rowCount === 0) {
      await client.query(`
        ALTER TABLE questions
        ADD CONSTRAINT questions_exam_id_fkey
        FOREIGN KEY (exam_id)
        REFERENCES exams(id)
        ON DELETE CASCADE
      `);
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS questions_exam_id_idx
      ON questions(exam_id)
    `);

    /* =================================================
       RESULTS TABLE
    ================================================= */

    await client.query(`
      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY
      )
    `);

    await client.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS exam_id INTEGER,
      ADD COLUMN IF NOT EXISTS student_name TEXT,
      ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS percentage NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    /*
      Foreign key results -> exams
    */

    const resultFK =
      await client.query(`
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'results_exam_id_fkey'
      `);

    if (resultFK.rowCount === 0) {
      await client.query(`
        ALTER TABLE results
        ADD CONSTRAINT results_exam_id_fkey
        FOREIGN KEY (exam_id)
        REFERENCES exams(id)
        ON DELETE CASCADE
      `);
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS results_exam_id_idx
      ON results(exam_id)
    `);

    await client.query("COMMIT");

    console.log(
      "✅ Database migrations completed."
    );

  } catch (error) {
    await client.query("ROLLBACK");

    console.error(
      "❌ Database initialization failed:",
      error.message
    );

    throw error;

  } finally {
    client.release();
  }
}

/* =====================================================
   HOME
===================================================== */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =====================================================
   HEALTH
===================================================== */

app.get("/api/health", async (req, res) => {
  try {

    await pool.query("SELECT 1");

    res.json({
      ok: true,
      app: "Hidaayatul-Bayaan",
      database: "PostgreSQL connected"
    });

  } catch (error) {

    console.error(
      "❌ Health error:",
      error.message
    );

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =====================================================
   CREATE EXAM
===================================================== */

app.post("/api/exams", async (req, res) => {
  try {

    const {
      teacher_name,
      teacherName,
      title,
      subject,
      grade,
      duration
    } = req.body;

    const teacher =
      teacher_name ||
      teacherName ||
      "";

    if (!teacher.trim()) {
      return res.status(400).json({
        error:
          "Maqaa barsiisaa guuti."
      });
    }

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        error:
          "Maqaa qormaataa guuti."
      });
    }

    const finalSubject =
      subject || "";

    const finalGrade =
      grade || "";

    const finalDuration =
      Number(duration) > 0
        ? Number(duration)
        : 30;

    let exam = null;

    let lastError = null;

    /*
      Code addaa uumuuf yaalii 10.
    */

    for (let i = 0; i < 10; i++) {

      const code =
        makeCode(8);

      try {

        const result =
          await pool.query(
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
              creator_id,
              created_at
            )
            VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $6,
              NULL,
              CURRENT_TIMESTAMP
            )
            RETURNING *
            `,
            [
              teacher.trim(),
              String(title).trim(),
              finalSubject,
              finalGrade,
              finalDuration,
              code
            ]
          );

        exam =
          result.rows[0];

        break;

      } catch (error) {

        lastError = error;

        /*
          Duplicate code yoo ta'e,
          code biraa yaala.
        */

        if (error.code === "23505") {
          continue;
        }

        throw error;
      }
    }

    if (!exam) {

      return res.status(500).json({
        error:
          lastError?.message ||
          "Qormaata uumuu hin dandeenye."
      });
    }

    const examCode =
      exam.code ||
      exam.exam_code;

    res.status(201).json({

      success: true,

      exam: {
        id: exam.id,
        code: examCode,
        exam_code: examCode,
        teacher_name:
          exam.teacher_name,
        title:
          exam.title,
        subject:
          exam.subject,
        grade:
          exam.grade,
        duration:
          exam.duration
      },

      link:
        `${req.protocol}://${req.get("host")}/?exam=${examCode}`
    });

  } catch (error) {

    console.error(
      "❌ Exam creation error:",
      error
    );

    res.status(500).json({
      error:
        error.message ||
        "Qormaata uumuu irratti rakkoon uumame."
    });
  }
});

/* =====================================================
   GET EXAM BY CODE
===================================================== */

app.get(
  "/api/exams/code/:code",
  async (req, res) => {

    try {

      const code =
        String(req.params.code || "")
          .trim()
          .toUpperCase();

      if (!code) {
        return res.status(400).json({
          error:
            "Exam code galchi."
        });
      }

      const result =
        await pool.query(
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
          error:
            "Koodiin qormaataa kun hin argamne."
        });
      }

      res.json({
        success: true,
        exam:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "❌ Get exam error:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   ADD QUESTION
===================================================== */

app.post(
  "/api/exams/:id/questions",
  async (req, res) => {

    try {

      const examId =
        Number(req.params.id);

      if (
        !Number.isInteger(examId) ||
        examId <= 0
      ) {
        return res.status(400).json({
          error:
            "Exam ID sirrii miti."
        });
      }

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

      if (
        !question ||
        !String(question).trim()
      ) {
        return res.status(400).json({
          error:
            "Gaaffii guuti."
        });
      }

      if (
        !correct_answer ||
        !String(correct_answer).trim()
      ) {
        return res.status(400).json({
          error:
            "Deebii sirrii filadhu."
        });
      }

      const exam =
        await pool.query(
          `
          SELECT id
          FROM exams
          WHERE id = $1
          `,
          [examId]
        );

      if (exam.rows.length === 0) {

        return res.status(404).json({
          error:
            "Qormaanni hin argamne."
        });
      }

      const result =
        await pool.query(
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
            points,
            created_at
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            CURRENT_TIMESTAMP
          )
          RETURNING *
          `,
          [
            examId,
            String(question).trim(),
            type || "multiple",
            option_a || "",
            option_b || "",
            option_c || "",
            option_d || "",
            String(correct_answer).trim(),
            Number(points) > 0
              ? Number(points)
              : 1
          ]
        );

      res.status(201).json({
        success: true,
        question:
          result.rows[0]
      });

    } catch (error) {

      console.error(
        "❌ Add question error:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   GET QUESTIONS
   Studentf deebii sirrii hin argatu.
===================================================== */

app.get(
  "/api/exams/:id/questions",
  async (req, res) => {

    try {

      const examId =
        Number(req.params.id);

      const result =
        await pool.query(
          `
          SELECT
            id,
            exam_id,
            question,
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
        questions:
          result.rows
      });

    } catch (error) {

      console.error(
        "❌ Questions error:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   SUBMIT EXAM
===================================================== */

app.post(
  "/api/exams/:id/submit",
  async (req, res) => {

    try {

      const examId =
        Number(req.params.id);

      const {
        student_name,
        studentName,
        answers
      } = req.body;

      const student =
        student_name ||
        studentName ||
        "";

      if (!student.trim()) {
        return res.status(400).json({
          error:
            "Maqaa barataa galchi."
        });
      }

      const examResult =
        await pool.query(
          `
          SELECT *
          FROM exams
          WHERE id = $1
          `,
          [examId]
        );

      if (examResult.rows.length === 0) {

        return res.status(404).json({
          error:
            "Qormaata hin argamne."
        });
      }

      const questionsResult =
        await pool.query(
          `
          SELECT *
          FROM questions
          WHERE exam_id = $1
          ORDER BY id ASC
          `,
          [examId]
        );

      const questions =
        questionsResult.rows;

      if (questions.length === 0) {

        return res.status(400).json({
          error:
            "Qormaata kana keessatti gaaffiin hin jiru."
        });
      }

      let score = 0;
      let total = 0;

      for (const q of questions) {

        const points =
          Number(q.points || 1);

        total += points;

        const userAnswer =
          answers &&
          answers[q.id] !== undefined
            ? String(
                answers[q.id]
              )
                .trim()
                .toLowerCase()
            : "";

        const correctAnswer =
          String(
            q.correct_answer || ""
          )
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
          ? Math.round(
              (score / total) * 100
            )
          : 0;

      const saved =
        await pool.query(
          `
          INSERT INTO results
          (
            exam_id,
            student_name,
            score,
            total,
            percentage,
            answers,
            created_at
          )
          VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            CURRENT_TIMESTAMP
          )
          RETURNING *
          `,
          [
            examId,
            student.trim(),
            score,
            total,
            percentage,
            JSON.stringify(
              answers || {}
            )
          ]
        );

      res.status(201).json({
        success: true,

        result: {
          id:
            saved.rows[0].id,
          student_name:
            student.trim(),
          score,
          total,
          percentage
        }
      });

    } catch (error) {

      console.error(
        "❌ Submit error:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   TEACHER RESULTS
===================================================== */

app.get(
  "/api/exams/:id/results",
  async (req, res) => {

    try {

      const examId =
        Number(req.params.id);

      const examResult =
        await pool.query(
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
          WHERE id = $1
          `,
          [examId]
        );

      if (examResult.rows.length === 0) {

        return res.status(404).json({
          error:
            "Qormaata hin argamne."
        });
      }

      const exam =
        examResult.rows[0];

      const questionsResult =
        await pool.query(
          `
          SELECT *
          FROM questions
          WHERE exam_id = $1
          ORDER BY id ASC
          `,
          [examId]
        );

      const resultsResult =
        await pool.query(
          `
          SELECT *
          FROM results
          WHERE exam_id = $1
          ORDER BY created_at DESC
          `,
          [examId]
        );

      const questions =
        questionsResult.rows;

      const results =
        resultsResult.rows;

      const students =
        results.map((result) => {

          const answers =
            result.answers || {};

          let correctCount = 0;
          let wrongCount = 0;
          let unansweredCount = 0;

          const details =
            questions.map(
              (q, index) => {

                const studentAnswer =
                  answers[q.id] !== undefined
                    ? String(
                        answers[q.id]
                      )
                    : "";

                const correctAnswer =
                  String(
                    q.correct_answer || ""
                  );

                let status =
                  "unanswered";

                if (
                  !studentAnswer.trim()
                ) {

                  unansweredCount++;

                  status =
                    "unanswered";

                } else if (
                  studentAnswer
                    .trim()
                    .toLowerCase() ===
                  correctAnswer
                    .trim()
                    .toLowerCase()
                ) {

                  correctCount++;

                  status =
                    "correct";

                } else {

                  wrongCount++;

                  status =
                    "wrong";
                }

                return {
                  number:
                    index + 1,

                  question:
                    q.question,

                  student_answer:
                    studentAnswer,

                  correct_answer:
                    correctAnswer,

                  points:
                    Number(
                      q.points || 1
                    ),

                  status
                };
              }
            );

          return {
            id:
              result.id,

            student_name:
              result.student_name,

            score:
              Number(
                result.score || 0
              ),

            total:
              Number(
                result.total || 0
              ),

            percentage:
              Number(
                result.percentage || 0
              ),

            created_at:
              result.created_at,

            correct_count:
              correctCount,

            wrong_count:
              wrongCount,

            unanswered_count:
              unansweredCount,

            details
          };
        });

      res.json({
        success: true,
        exam,
        students
      });

    } catch (error) {

      console.error(
        "❌ Results error:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   DELETE QUESTION
===================================================== */

app.delete(
  "/api/questions/:id",
  async (req, res) => {

    try {

      const questionId =
        Number(req.params.id);

      const result =
        await pool.query(
          `
          DELETE FROM questions
          WHERE id = $1
          RETURNING id
          `,
          [questionId]
        );

      if (result.rows.length === 0) {

        return res.status(404).json({
          error:
            "Gaaffiin hin argamne."
        });
      }

      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "❌ Delete question error:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =====================================================
   API 404
===================================================== */

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({
      error:
        "API route kun hin argamne."
    });
  }
);

/* =====================================================
   SERVER START
===================================================== */

async function startServer() {

  try {

    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `🚀 Hidaayatul-Bayaan server running on port ${PORT}`
        );

      }
    );

  } catch (error) {

    console.error(
      "❌ Server start failed:",
      error.message
    );

    process.exit(1);
  }
}

startServer();

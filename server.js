const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Supabase environment variables hin argamne.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function makeCode(length = 8) {
  return crypto
    .randomBytes(10)
    .toString("hex")
    .slice(0, length)
    .toUpperCase();
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
    const { error } = await supabase
      .from("exams")
      .select("id")
      .limit(1);

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }

    res.json({
      ok: true,
      app: "Hidaayatul-Bayaan",
      database: "Supabase connected"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
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

      const result = await supabase
        .from("exams")
        .insert({
          teacher_name,
          title,
          subject: subject || "",
          grade: grade || "",
          duration: Number(duration) || 30,
          exam_code
        })
        .select()
        .single();

      if (!result.error) {
        exam = result.data;
        break;
      }

      lastError = result.error;
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
    const examId = req.params.id;

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

    const {
      data: exam,
      error: examError
    } = await supabase
      .from("exams")
      .select("id")
      .eq("id", examId)
      .single();

    if (examError || !exam) {
      return res.status(404).json({
        error: "Qormaanni hin argamne."
      });
    }

    const {
      data,
      error
    } = await supabase
      .from("questions")
      .insert({
        exam_id: examId,
        question,
        type: type || "multiple",
        option_a: option_a || "",
        option_b: option_b || "",
        option_c: option_c || "",
        option_d: option_d || "",
        correct_answer,
        points: Number(points) || 1
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      success: true,
      question: data
    });
  } catch (error) {
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
    const code =
      req.params.code.trim().toUpperCase();

    const {
      data: exam,
      error: examError
    } = await supabase
      .from("exams")
      .select("*")
      .eq("exam_code", code)
      .single();

    if (examError || !exam) {
      return res.status(404).json({
        error: "Qormaata kana hin arganne."
      });
    }

    const {
      data: questions,
      error: qError
    } = await supabase
      .from("questions")
      .select(
        "id,question,type,option_a,option_b,option_c,option_d,points"
      )
      .eq("exam_id", exam.id)
      .order("created_at", {
        ascending: true
      });

    if (qError) {
      return res.status(500).json({
        error: qError.message
      });
    }

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
      questions: questions || []
    });
  } catch (error) {
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
    const {
      data,
      error
    } = await supabase
      .from("questions")
      .select("*")
      .eq("exam_id", req.params.id)
      .order("created_at", {
        ascending: true
      });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      questions: data || []
    });
  } catch (error) {
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
    const examId = req.params.id;

    const {
      student_name,
      answers
    } = req.body;

    if (!student_name) {
      return res.status(400).json({
        error: "Maqaa barataa galchi."
      });
    }

    const {
      data: exam,
      error: examError
    } = await supabase
      .from("exams")
      .select("*")
      .eq("id", examId)
      .single();

    if (examError || !exam) {
      return res.status(404).json({
        error: "Qormaata hin argamne."
      });
    }

    const {
      data: questions,
      error: qError
    } = await supabase
      .from("questions")
      .select("*")
      .eq("exam_id", examId)
      .order("created_at", {
        ascending: true
      });

    if (qError) {
      return res.status(500).json({
        error: qError.message
      });
    }

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

    const {
      data: result,
      error: resultError
    } = await supabase
      .from("results")
      .insert({
        exam_id: examId,
        student_name,
        score,
        total,
        percentage,
        answers: answers || {}
      })
      .select()
      .single();

    if (resultError) {
      return res.status(500).json({
        error: resultError.message
      });
    }

    res.json({
      success: true,
      result: {
        id: result.id,
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
    const examId = req.params.id;

    const {
      data: exam,
      error: examError
    } = await supabase
      .from("exams")
      .select(
        "id,title,subject,grade,duration,exam_code,teacher_name"
      )
      .eq("id", examId)
      .single();

    if (examError || !exam) {
      return res.status(404).json({
        error: "Qormaata hin argamne."
      });
    }

    const {
      data: questions,
      error: qError
    } = await supabase
      .from("questions")
      .select("*")
      .eq("exam_id", examId)
      .order("created_at", {
        ascending: true
      });

    if (qError) {
      return res.status(500).json({
        error: qError.message
      });
    }

    const {
      data: results,
      error: rError
    } = await supabase
      .from("results")
      .select("*")
      .eq("exam_id", examId)
      .order("created_at", {
        ascending: false
      });

    if (rError) {
      return res.status(500).json({
        error: rError.message
      });
    }

    const students =
      (results || []).map((result) => {

        const answers =
          result.answers || {};

        let correctCount = 0;
        let wrongCount = 0;
        let unansweredCount = 0;

        const details =
          (questions || []).map((q, index) => {

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
    const {
      error
    } = await supabase
      .from("questions")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      success: true
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});
/* =========================
   START SERVER
========================= */

server.listen(
  PORT,
  "0.0.0.0",
  async () => {
    console.log(
      `✅ Mullisa-JM server running on port ${PORT}`
    );

    try {
      console.log(
        "🔄 Database initialization jalqabame..."
      );

      const connected =
        await testDatabase();

      if (!connected) {
        console.error(
          "❌ Database connection failed."
        );

        return;
      }

      await initDatabase();

      console.log(
        "✅ Database initialization completed."
      );
    } catch (error) {
      console.error(
        "❌ Database initialization error:",
        error.message
      );
    }
  }
);

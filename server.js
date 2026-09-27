const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
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

app.use(express.json({ limit: "2mb" }));
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
  res.sendFile(path.join(__dirname, "public", "index.html"));
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
      app: "Kaayyoo 3.0",
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
   TEACHER REGISTER
========================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      full_name,
      email,
      password
    } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        error: "Maqaa, email fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const cleanEmail = String(email)
      .trim()
      .toLowerCase();

    const { data: existing } = await supabase
      .from("teachers")
      .select("id")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: "Email kun duraan galmaa'eera."
      });
    }

    const passwordHash = await bcrypt.hash(
      password,
      10
    );

    const { data, error } = await supabase
      .from("teachers")
      .insert({
        full_name: String(full_name).trim(),
        email: cleanEmail,
        password: passwordHash
      })
      .select("id, full_name, email, created_at")
      .single();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      success: true,
      message: "Galmeen milkaa'eera.",
      teacher: data
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   TEACHER LOGIN
========================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email fi password guuti."
      });
    }

    const cleanEmail = String(email)
      .trim()
      .toLowerCase();

    const { data: teacher, error } =
      await supabase
        .from("teachers")
        .select("*")
        .eq("email", cleanEmail)
        .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    if (!teacher) {
      return res.status(401).json({
        error: "Email ykn password sirrii miti."
      });
    }

    const passwordOK = await bcrypt.compare(
      password,
      teacher.password
    );

    if (!passwordOK) {
      return res.status(401).json({
        error: "Email ykn password sirrii miti."
      });
    }

    res.json({
      success: true,
      message: "Seensa milkaa'eera.",
      teacher: {
        id: teacher.id,
        full_name: teacher.full_name,
        email: teacher.email
      }
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   TEACHER PROFILE
========================= */

app.get("/api/teachers/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("teachers")
      .select("id, full_name, email, created_at")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({
        error: "Barsiisaa hin argamne."
      });
    }

    res.json({
      teacher: data
    });

  } catch (error) {
    res.status(500).json({
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
      teacher_id,
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

    const exam_code = makeCode(8);

    const insertData = {
      teacher_name,
      title,
      subject: subject || "",
      grade: grade || "",
      duration: Number(duration) || 30,
      exam_code
    };

    /*
      teacher_id yoo schema keessatti jiraate,
      itti dabala.
    */
    if (teacher_id) {
      insertData.teacher_id = teacher_id;
    }

    const { data, error } = await supabase
      .from("exams")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      /*
        Yoo teacher_id column hin jirre,
        qormaata teacher_id malee uuma.
      */
      if (
        teacher_id &&
        error.message &&
        error.message.includes("teacher_id")
      ) {
        delete insertData.teacher_id;

        const retry = await supabase
          .from("exams")
          .insert(insertData)
          .select()
          .single();

        if (retry.error) {
          return res.status(500).json({
            error: retry.error.message
          });
        }

        return res.json({
          success: true,
          exam: retry.data
        });
      }

      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      success: true,
      exam: data
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   GET TEACHER EXAMS
========================= */

app.get("/api/teachers/:id/exams", async (req, res) => {
  try {
    /*
      teacher_id yoo jiraate itti fayyadama.
    */

    const { data, error } = await supabase
      .from("exams")
      .select("*")
      .eq("teacher_id", req.params.id)
      .order("created_at", {
        ascending: false
      });

    if (!error) {
      return res.json({
        exams: data || []
      });
    }

    /*
      teacher_id column yoo hin jirre,
      maqaa barsiisaa irratti fallback godha.
    */

    const { data: teacher } = await supabase
      .from("teachers")
      .select("full_name")
      .eq("id", req.params.id)
      .single();

    if (!teacher) {
      return res.status(404).json({
        error: "Barsiisaa hin argamne."
      });
    }

    const fallback = await supabase
      .from("exams")
      .select("*")
      .eq("teacher_name", teacher.full_name)
      .order("created_at", {
        ascending: false
      });

    if (fallback.error) {
      return res.status(500).json({
        error: fallback.error.message
      });
    }

    res.json({
      exams: fallback.data || []
    });

  } catch (error) {
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

    const { data: exam } = await supabase
      .from("exams")
      .select("id")
      .eq("id", examId)
      .single();

    if (!exam) {
      return res.status(404).json({
        error: "Qormaanni hin argamne."
      });
    }

    const { data, error } = await supabase
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
========================= */

app.get("/api/exams/code/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    const { data: exam, error } = await supabase
      .from("exams")
      .select("*")
      .eq("exam_code", code)
      .single();

    if (error || !exam) {
      return res.status(404).json({
        error: "Qormaata kana hin arganne."
      });
    }

    const { data: questions, error: qError } =
      await supabase
        .from("questions")
        .select("*")
        .eq("exam_id", exam.id)
        .order("created_at", {
          ascending: true
        });

    if (qError) {
      return res.status(500).json({
        error: qError.message
      });
    }

    const cleanQuestions = (questions || []).map(q => ({
      id: q.id,
      question: q.question,
      type: q.type,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d
    }));

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
      questions: cleanQuestions
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

    const { data: exam, error: examError } =
      await supabase
        .from("exams")
        .select("*")
        .eq("id", examId)
        .single();

    if (examError || !exam) {
      return res.status(404).json({
        error: "Qormaata hin argamne."
      });
    }

    const { data: questions, error: qError } =
      await supabase
        .from("questions")
        .select("*")
        .eq("exam_id", examId);

    if (qError) {
      return res.status(500).json({
        error: qError.message
      });
    }

    let score = 0;
    let total = 0;

    for (const q of questions || []) {
      const points = Number(q.points || 1);

      total += points;

      const userAnswer =
        answers && answers[q.id]
          ? String(answers[q.id])
              .trim()
              .toLowerCase()
          : "";

      const correct =
        String(q.correct_answer)
          .trim()
          .toLowerCase();

      if (userAnswer === correct) {
        score += points;
      }
    }

    const percentage =
      total > 0
        ? Math.round((score / total) * 100)
        : 0;

    const { data: result, error: resultError } =
      await supabase
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
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   RESULTS
========================= */

app.get("/api/exams/:id/results", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("results")
      .select(
        "id, student_name, score, total, percentage, created_at"
      )
      .eq("exam_id", req.params.id)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    res.json({
      results: data || []
    });

  } catch (error) {
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
    const { error } = await supabase
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `✅ Kaayyoo 3.0 server running on port ${PORT}`
  );
});

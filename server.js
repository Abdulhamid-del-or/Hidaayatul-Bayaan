const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// SUPABASE
// ===============================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL ykn SUPABASE_SERVICE_ROLE_KEY hin argamne.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// ===============================
// BASIC
// ===============================

app.get("/api/health", async (req, res) => {
  try {
    const { error } = await supabase
      .from("teachers")
      .select("id")
      .limit(1);

    if (error) {
      return res.status(500).json({
        ok: false,
        app: "Kaayyoo",
        database: "Supabase error",
        error: error.message
      });
    }

    res.json({
      ok: true,
      app: "Kaayyoo",
      database: "Supabase connected"
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      app: "Kaayyoo",
      error: error.message
    });
  }
});

// ===============================
// TEACHER REGISTER
// ===============================

app.post("/api/auth/register", async (req, res) => {
  try {
    const {
      full_name,
      email,
      password
    } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Maqaa, email fi password guuti."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password yoo xiqqaate qubee 6 qabaachuu qaba."
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Email duraan jira moo?
    const { data: existingTeacher, error: findError } =
      await supabase
        .from("teachers")
        .select("id")
        .eq("email", cleanEmail)
        .maybeSingle();

    if (findError) {
      return res.status(500).json({
        success: false,
        message: findError.message
      });
    }

    if (existingTeacher) {
      return res.status(409).json({
        success: false,
        message: "Email kun duraan galmaa'eera."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("teachers")
      .insert([
        {
          full_name: full_name.trim(),
          email: cleanEmail,
          password: passwordHash
        }
      ])
      .select("id, full_name, email")
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.status(201).json({
      success: true,
      message: "Barsiisaan milkaa'inaan galmaa'eera.",
      teacher: data,
      teacher_id: data.id
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Register irratti rakkoon uumame.",
      error: error.message
    });
  }
});

// ===============================
// TEACHER LOGIN
// ===============================

app.post("/api/auth/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email fi password guuti."
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const { data: teacher, error } = await supabase
      .from("teachers")
      .select("*")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    if (!teacher) {
      return res.status(401).json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    const passwordOK = await bcrypt.compare(
      password,
      teacher.password
    );

    if (!passwordOK) {
      return res.status(401).json({
        success: false,
        message: "Email ykn password sirrii miti."
      });
    }

    res.json({
      success: true,
      message: "Login milkaa'eera.",
      teacher: {
        id: teacher.id,
        full_name: teacher.full_name,
        email: teacher.email
      },
      teacher_id: teacher.id
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Login irratti rakkoon uumame.",
      error: error.message
    });
  }
});

// ===============================
// GET TEACHER
// ===============================

app.get("/api/teachers/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("teachers")
      .select("id, full_name, email, created_at")
      .eq("id", req.params.id)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        message: "Barsiisaa hin argamne.",
        error: error.message
      });
    }

    res.json({
      success: true,
      teacher: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// CREATE EXAM
// ===============================

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

    if (!teacher_id) {
      return res.status(400).json({
        success: false,
        message: "Teacher ID hin jiru."
      });
    }

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Mata-duree qormaataa galchi."
      });
    }

    // Exam code unique
    const exam_code =
      Math.random().toString(36).substring(2, 10).toUpperCase();

    const insertData = {
      teacher_id,
      teacher_name: teacher_name || "",
      title: title.trim(),
      subject: subject || "",
      grade: grade || "",
      duration: Number(duration) || 30,
      exam_code
    };

    const { data, error } = await supabase
      .from("exams")
      .insert([insertData])
      .select("*")
      .single();

    if (error) {
      console.error("CREATE EXAM ERROR:", error);

      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    const host =
      `${req.protocol}://${req.get("host")}`;

    const exam_link =
      `${host}/?exam=${data.exam_code}`;

    res.status(201).json({
      success: true,
      message: "Qormaanni uumameera.",
      exam: {
        ...data,
        exam_link
      }
    });

  } catch (error) {
    console.error("EXAM ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Qormaata uumuu irratti rakkoon uumame.",
      error: error.message
    });
  }
});

// ===============================
// GET TEACHER EXAMS
// ===============================

app.get("/api/teachers/:id/exams", async (req, res) => {
  try {
    const teacherId = req.params.id;

    const { data, error } = await supabase
      .from("exams")
      .select("*")
      .eq("teacher_id", teacherId)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    const host =
      `${req.protocol}://${req.get("host")}`;

    const exams = (data || []).map(exam => ({
      ...exam,
      exam_link:
        `${host}/?exam=${exam.exam_code}`
    }));

    res.json({
      success: true,
      exams
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// GET EXAM BY CODE
// ===============================

app.get("/api/exams/code/:code", async (req, res) => {
  try {
    const code =
      req.params.code.trim().toUpperCase();

    const { data: exam, error } = await supabase
      .from("exams")
      .select("*")
      .eq("exam_code", code)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Qormaanni kun hin argamne."
      });
    }

    const { data: questions, error: questionError } =
      await supabase
        .from("questions")
        .select(
          "id, question, type, option_a, option_b, option_c, option_d, points"
        )
        .eq("exam_id", exam.id)
        .order("created_at", {
          ascending: true
        });

    if (questionError) {
      return res.status(500).json({
        success: false,
        message: questionError.message
      });
    }

    res.json({
      success: true,
      exam,
      questions: questions || []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// ADD QUESTION
// ===============================

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
        success: false,
        message: "Gaaffii fi deebii sirrii guuti."
      });
    }

    const { data, error } = await supabase
      .from("questions")
      .insert([
        {
          exam_id: examId,
          question: question.trim(),
          type: type || "multiple",
          option_a: option_a || "",
          option_b: option_b || "",
          option_c: option_c || "",
          option_d: option_d || "",
          correct_answer: correct_answer.trim(),
          points: Number(points) || 1
        }
      ])
      .select("*")
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.status(201).json({
      success: true,
      message: "Gaaffiin dabalameera.",
      question: data
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// GET QUESTIONS
// ===============================

app.get("/api/exams/:id/questions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("exam_id", req.params.id)
      .order("created_at", {
        ascending: true
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      questions: data || []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// DELETE QUESTION
// ===============================

app.delete("/api/questions/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("questions")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      message: "Gaaffiin haqameera."
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// SUBMIT EXAM
// ===============================

app.post("/api/exams/:id/submit", async (req, res) => {
  try {
    const examId = req.params.id;

    const {
      student_name,
      answers
    } = req.body;

    if (!student_name) {
      return res.status(400).json({
        success: false,
        message: "Maqaa barataa galchi."
      });
    }

    // Get questions with correct answers
    const { data: questions, error } =
      await supabase
        .from("questions")
        .select("*")
        .eq("exam_id", examId)
        .order("created_at", {
          ascending: true
        });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    if (!questions || questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Qormaata kana keessatti gaaffiin hin jiru."
      });
    }

    let score = 0;
    let total = 0;

    const answerData = answers || {};

    for (const q of questions) {
      const points = Number(q.points) || 1;

      total += points;

      const studentAnswer =
        answerData[q.id];

      if (
        studentAnswer &&
        String(studentAnswer).trim().toLowerCase() ===
        String(q.correct_answer).trim().toLowerCase()
      ) {
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
        .insert([
          {
            exam_id: examId,
            student_name: student_name.trim(),
            score,
            total,
            percentage,
            answers: answerData
          }
        ])
        .select("*")
        .single();

    if (resultError) {
      return res.status(500).json({
        success: false,
        message: resultError.message
      });
    }

    res.json({
      success: true,
      message: "Qormaanni xumurameera.",
      result: {
        id: result.id,
        student_name: result.student_name,
        score,
        total,
        percentage
      }
    });

  } catch (error) {
    console.error("SUBMIT ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Qormaata erguu irratti rakkoon uumame.",
      error: error.message
    });
  }
});

// ===============================
// GET RESULTS
// ===============================

app.get("/api/exams/:id/results", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("results")
      .select("*")
      .eq("exam_id", req.params.id)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      results: data || []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// DELETE EXAM
// ===============================

app.delete("/api/exams/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("exams")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      message: "Qormaanni haqameera."
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// FRONTEND
// ===============================

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ===============================
// SERVER
// ===============================

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("🚀 KAAYYOO SERVER");
  console.log("=================================");
  console.log(`✅ Port: ${PORT}`);
  console.log("✅ Supabase connected");
  console.log("✅ Teacher Register/Login");
  console.log("✅ Teacher ID");
  console.log("✅ Exam Create");
  console.log("✅ Exam Link");
  console.log("✅ Questions");
  console.log("✅ Student Exam");
  console.log("✅ Auto Scoring");
  console.log("✅ Results");
  console.log("=================================");
});

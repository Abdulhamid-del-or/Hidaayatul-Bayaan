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
  console.error(
    "❌ SUPABASE_URL ykn SUPABASE_SERVICE_ROLE_KEY hin argamne."
  );
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

function cleanQuestion(question) {
  return {
    id: question.id,
    question: question.question,
    type: question.type,
    option_a: question.option_a,
    option_b: question.option_b,
    option_c: question.option_c,
    option_d: question.option_d,
    points: Number(question.points || 1)
  };
}

/*
  Deebii barataa fi deebii sirrii wal bira qabsiisa.
*/
function analyzeAnswers(questions, answers) {
  const answerMap = answers || {};

  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  let score = 0;
  let total = 0;

  const details = questions.map((q, index) => {
    const points = Number(q.points || 1);

    total += points;

    const studentAnswer =
      answerMap[q.id] !== undefined &&
      answerMap[q.id] !== null
        ? String(answerMap[q.id]).trim()
        : "";

    const correctAnswer =
      q.correct_answer !== undefined &&
      q.correct_answer !== null
        ? String(q.correct_answer).trim()
        : "";

    let status = "unanswered";

    if (!studentAnswer) {
      unansweredCount++;
      status = "unanswered";
    } else if (
      studentAnswer.toLowerCase() ===
      correctAnswer.toLowerCase()
    ) {
      correctCount++;
      score += points;
      status = "correct";
    } else {
      wrongCount++;
      status = "wrong";
    }

    return {
      number: index + 1,
      question_id: q.id,
      question: q.question,
      type: q.type,
      option_a: q.option_a || "",
      option_b: q.option_b || "",
      option_c: q.option_c || "",
      option_d: q.option_d || "",
      student_answer: studentAnswer,
      correct_answer: correctAnswer,
      points,
      status
    };
  });

  const percentage =
    total > 0
      ? Math.round((score / total) * 100)
      : 0;

  return {
    score,
    total,
    percentage,
    correct_count: correctCount,
    wrong_count: wrongCount,
    unanswered_count: unansweredCount,
    details
  };
}

/* HOME */
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* HEALTH */
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

/* CREATE EXAM */
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
        error:
          "Maqaa barsiisaa fi maqaa qormaataa guuti."
      });
    }

    const exam_code = makeCode(8);

    const { data, error } = await supabase
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

    if (error) {
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

/* ADD QUESTION */
app.post(
  "/api/exams/:id/questions",
  async (req, res) => {
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
  }
);

/* GET EXAM BY CODE */
app.get(
  "/api/exams/code/:code",
  async (req, res) => {
    try {
      const code =
        req.params.code.toUpperCase();

      const { data: exam, error } =
        await supabase
          .from("exams")
          .select("*")
          .eq("exam_code", code)
          .single();

      if (error || !exam) {
        return res.status(404).json({
          error:
            "Qormaata kana hin arganne."
        });
      }

      const {
        data: questions,
        error: qError
      } = await supabase
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
        questions:
          questions.map(cleanQuestion)
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* SUBMIT EXAM */
app.post(
  "/api/exams/:id/submit",
  async (req, res) => {
    try {
      const examId = req.params.id;

      const {
        student_name,
        answers
      } = req.body;

      if (!student_name) {
        return res.status(400).json({
          error:
            "Maqaa barataa galchi."
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
          error:
            "Qormaata hin argamne."
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

      const analysis =
        analyzeAnswers(
          questions,
          answers
        );

      const {
        data: result,
        error: resultError
      } = await supabase
        .from("results")
        .insert({
          exam_id: examId,
          student_name,
          score: analysis.score,
          total: analysis.total,
          percentage:
            analysis.percentage,
          answers: answers || {}
        })
        .select()
        .single();

      if (resultError) {
        return res.status(500).json({
          error:
            resultError.message
        });
      }

      res.json({
        success: true,
        result: {
          id: result.id,
          student_name,
          score: analysis.score,
          total: analysis.total,
          percentage:
            analysis.percentage,
          correct_count:
            analysis.correct_count,
          wrong_count:
            analysis.wrong_count,
          unanswered_count:
            analysis.unanswered_count,
          details: analysis.details
        }
      });
    } catch (error) {
      console.error(
        "SUBMIT ERROR:",
        error
      );

      res.status(500).json({
        error: error.message
      });
    }
  }
);

/*
  BU'AA BARATAA TOKKO
*/
app.get(
  "/api/results/:resultId",
  async (req, res) => {
    try {
      const { data: result, error } =
        await supabase
          .from("results")
          .select("*")
          .eq(
            "id",
            req.params.resultId
          )
          .single();

      if (error || !result) {
        return res.status(404).json({
          error:
            "Bu'aan hin argamne."
        });
      }

      const {
        data: questions,
        error: qError
      } = await supabase
        .from("questions")
        .select("*")
        .eq(
          "exam_id",
          result.exam_id
        )
        .order("created_at", {
          ascending: true
        });

      if (qError) {
        return res.status(500).json({
          error: qError.message
        });
      }

      const analysis =
        analyzeAnswers(
          questions,
          result.answers || {}
        );

      res.json({
        result: {
          id: result.id,
          exam_id: result.exam_id,
          student_name:
            result.student_name,
          score: analysis.score,
          total: analysis.total,
          percentage:
            analysis.percentage,
          correct_count:
            analysis.correct_count,
          wrong_count:
            analysis.wrong_count,
          unanswered_count:
            analysis.unanswered_count,
          created_at:
            result.created_at
        },
        details:
          analysis.details
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/*
  BARSIISAAF:
  BU'AA BARATTOOTA HUNDAA
*/
app.get(
  "/api/exams/:id/results",
  async (req, res) => {
    try {
      const examId =
        req.params.id;

      const {
        data: results,
        error
      } = await supabase
        .from("results")
        .select(
          "id, exam_id, student_name, score, total, percentage, answers, created_at"
        )
        .eq("exam_id", examId)
        .order("created_at", {
          ascending: false
        });

      if (error) {
        return res.status(500).json({
          error: error.message
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

      const detailedResults =
        results.map((result) => {
          const analysis =
            analyzeAnswers(
              questions,
              result.answers || {}
            );

          return {
            id: result.id,
            exam_id: result.exam_id,
            student_name:
              result.student_name,
            score: analysis.score,
            total: analysis.total,
            percentage:
              analysis.percentage,
            correct_count:
              analysis.correct_count,
            wrong_count:
              analysis.wrong_count,
            unanswered_count:
              analysis.unanswered_count,
            created_at:
              result.created_at,
            details:
              analysis.details
          };
        });

      res.json({
        results:
          detailedResults
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* DELETE QUESTION */
app.delete(
  "/api/questions/:id",
  async (req, res) => {
    try {
      const { error } =
        await supabase
          .from("questions")
          .delete()
          .eq(
            "id",
            req.params.id
          );

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
  }
);

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `✅ Hidaayatul-Bayaan server running on port ${PORT}`
    );
  }
);

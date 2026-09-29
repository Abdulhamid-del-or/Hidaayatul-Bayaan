const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = Number(process.env.PORT) || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

/* =========================
   SUPABASE CHECK
========================= */

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

/* =========================
   MIDDLEWARE
========================= */

app.use(
  express.json({
    limit: "5mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================
   HELPERS
========================= */

function makeCode(length = 8) {
  return crypto
    .randomBytes(16)
    .toString("hex")
    .slice(0, length)
    .toUpperCase();
}

function cleanQuestion(q) {
  return {
    id: q.id,
    question: q.question,
    type: q.type || "multiple",

    option_a: q.option_a || "",
    option_b: q.option_b || "",
    option_c: q.option_c || "",
    option_d: q.option_d || "",

    points: Number(q.points || 1)
  };
}

function normalizeAnswer(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isValidUUID(value) {
  if (!value) return false;

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {
  try {
    const { error } =
      await supabase
        .from("exams")
        .select("id")
        .limit(1);

    if (error) {
      return res.status(500).json({
        ok: false,
        database: "failed",
        error: error.message
      });
    }

    res.json({
      ok: true,
      app: "Hidaayatul-Bayaan",
      database: "Supabase connected"
    });

  } catch (error) {

    console.error(
      "HEALTH ERROR:",
      error
    );

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
        error:
          "Maqaa barsiisaa fi maqaa qormaataa guuti."
      });
    }

    const finalDuration =
      Number(duration);

    if (
      !Number.isFinite(finalDuration) ||
      finalDuration < 1
    ) {

      return res.status(400).json({
        error:
          "Yeroon qormaataa sirrii miti."
      });
    }

    let lastError = null;

    for (let attempt = 1; attempt <= 10; attempt++) {

      const exam_code =
        makeCode(8);

      const result =
        await supabase
          .from("exams")
          .insert({
            teacher_name:
              String(teacher_name).trim(),

            title:
              String(title).trim(),

            subject:
              String(subject || "").trim(),

            grade:
              String(grade || "").trim(),

            duration:
              finalDuration,

            exam_code
          })
          .select()
          .single();

      if (!result.error) {

        return res.json({
          success: true,
          exam: result.data
        });
      }

      lastError =
        result.error;
    }

    console.error(
      "CREATE EXAM ERROR:",
      lastError
    );

    return res.status(500).json({
      error:
        lastError?.message ||
        "Qormaata uumuu hin dandeenye."
    });

  } catch (error) {

    console.error(
      "CREATE EXAM ERROR:",
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================
   ADD QUESTION
========================= */

app.post(
  "/api/exams/:id/questions",
  async (req, res) => {

    try {

      const examId =
        req.params.id;

      if (!isValidUUID(examId)) {

        return res.status(400).json({
          error:
            "ID qormaataa sirrii miti."
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
            "Deebii sirrii guuti."
        });
      }

      const questionType =
        type === "truefalse"
          ? "truefalse"
          : "multiple";

      const finalPoints =
        Number(points);

      if (
        !Number.isFinite(finalPoints) ||
        finalPoints < 1
      ) {

        return res.status(400).json({
          error:
            "Qabxiin sirrii miti."
        });
      }

      let finalCorrectAnswer =
        String(correct_answer).trim();

      let finalOptionA =
        String(option_a || "").trim();

      let finalOptionB =
        String(option_b || "").trim();

      let finalOptionC =
        String(option_c || "").trim();

      let finalOptionD =
        String(option_d || "").trim();

      if (questionType === "multiple") {

        finalCorrectAnswer =
          finalCorrectAnswer.toUpperCase();

        if (
          !["A", "B", "C", "D"].includes(
            finalCorrectAnswer
          )
        ) {

          return res.status(400).json({
            error:
              "Deebiin sirrii A, B, C ykn D ta'uu qaba."
          });
        }

        if (
          !finalOptionA ||
          !finalOptionB ||
          !finalOptionC ||
          !finalOptionD
        ) {

          return res.status(400).json({
            error:
              "Filannoo A, B, C fi D guutuu qabu."
          });
        }

      } else {

        const normalized =
          finalCorrectAnswer.toLowerCase();

        if (
          normalized !== "dhugaa" &&
          normalized !== "soba"
        ) {

          return res.status(400).json({
            error:
              "Deebiin sirrii Dhugaa ykn Soba ta'uu qaba."
          });
        }

        finalCorrectAnswer =
          normalized === "dhugaa"
            ? "Dhugaa"
            : "Soba";

        finalOptionA =
          "Dhugaa";

        finalOptionB =
          "Soba";

        finalOptionC =
          "";

        finalOptionD =
          "";
      }

      /* CHECK EXAM */

      const {
        data: exam,
        error: examError
      } =
        await supabase
          .from("exams")
          .select("id")
          .eq("id", examId)
          .single();

      if (examError || !exam) {

        return res.status(404).json({
          error:
            "Qormaanni hin argamne."
        });
      }

      /* INSERT QUESTION */

      const {
        data,
        error
      } =
        await supabase
          .from("questions")
          .insert({
            exam_id:
              examId,

            question:
              String(question).trim(),

            type:
              questionType,

            option_a:
              finalOptionA,

            option_b:
              finalOptionB,

            option_c:
              finalOptionC,

            option_d:
              finalOptionD,

            correct_answer:
              finalCorrectAnswer,

            points:
              finalPoints
          })
          .select()
          .single();

      if (error) {

        console.error(
          "ADD QUESTION ERROR:",
          error
        );

        return res.status(500).json({
          error:
            error.message
        });
      }

      res.json({
        success: true,
        question: data
      });

    } catch (error) {

      console.error(
        "ADD QUESTION ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   GET EXAM BY CODE
   STUDENT
========================= */

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
            "Koodii qormaataa galchi."
        });
      }

      const {
        data: exam,
        error: examError
      } =
        await supabase
          .from("exams")
          .select(
            "id,title,subject,grade,duration,exam_code,teacher_name"
          )
          .eq(
            "exam_code",
            code
          )
          .maybeSingle();

      if (
        examError ||
        !exam
      ) {

        return res.status(404).json({
          error:
            "Qormaata kana hin arganne."
        });
      }

      const {
        data: questions,
        error: qError
      } =
        await supabase
          .from("questions")
          .select(
            "id,question,type,option_a,option_b,option_c,option_d,points"
          )
          .eq(
            "exam_id",
            exam.id
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          );

      if (qError) {

        return res.status(500).json({
          error:
            qError.message
        });
      }

      res.json({

        exam: {
          id:
            exam.id,

          title:
            exam.title,

          subject:
            exam.subject,

          grade:
            exam.grade,

          duration:
            exam.duration,

          exam_code:
            exam.exam_code,

          teacher_name:
            exam.teacher_name
        },

        questions:
          (questions || [])
            .map(cleanQuestion)

      });

    } catch (error) {

      console.error(
        "GET EXAM ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   GET QUESTIONS
   TEACHER
========================= */

app.get(
  "/api/exams/:id/questions",
  async (req, res) => {

    try {

      const examId =
        req.params.id;

      if (!isValidUUID(examId)) {

        return res.status(400).json({
          error:
            "ID qormaataa sirrii miti."
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("questions")
          .select("*")
          .eq(
            "exam_id",
            examId
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          );

      if (error) {

        return res.status(500).json({
          error:
            error.message
        });
      }

      res.json({
        questions:
          data || []
      });

    } catch (error) {

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   SUBMIT EXAM
========================= */

app.post(
  "/api/exams/:id/submit",
  async (req, res) => {

    try {

      const examId =
        req.params.id;

      const {
        student_name,
        answers
      } = req.body;

      if (!isValidUUID(examId)) {

        return res.status(400).json({
          error:
            "ID qormaataa sirrii miti."
        });
      }

      if (
        !student_name ||
        !String(student_name).trim()
      ) {

        return res.status(400).json({
          error:
            "Maqaa barataa galchi."
        });
      }

      const safeAnswers =
        answers &&
        typeof answers === "object" &&
        !Array.isArray(answers)
          ? answers
          : {};

      /* GET EXAM */

      const {
        data: exam,
        error: examError
      } =
        await supabase
          .from("exams")
          .select("*")
          .eq("id", examId)
          .single();

      if (
        examError ||
        !exam
      ) {

        return res.status(404).json({
          error:
            "Qormaata hin argamne."
        });
      }

      /* GET QUESTIONS */

      const {
        data: questions,
        error: qError
      } =
        await supabase
          .from("questions")
          .select("*")
          .eq(
            "exam_id",
            examId
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          );

      if (qError) {

        return res.status(500).json({
          error:
            qError.message
        });
      }

      let score = 0;
      let total = 0;

      let correctCount = 0;
      let wrongCount = 0;
      let unansweredCount = 0;

      const details = [];

      for (const q of questions || []) {

        const points =
          Number(q.points || 1);

        total += points;

        const studentAnswer =
          normalizeAnswer(
            safeAnswers[q.id]
          );

        const correctAnswer =
          normalizeAnswer(
            q.correct_answer
          );

        let status =
          "unanswered";

        if (!studentAnswer) {

          unansweredCount++;

          status =
            "unanswered";

        } else if (
          studentAnswer ===
          correctAnswer
        ) {

          score += points;

          correctCount++;

          status =
            "correct";

        } else {

          wrongCount++;

          status =
            "wrong";
        }

        details.push({
          question_id:
            q.id,

          question:
            q.question,

          student_answer:
            safeAnswers[q.id] !== undefined
              ? String(
                  safeAnswers[q.id]
                )
              : "",

          correct_answer:
            q.correct_answer,

          points,

          status
        });
      }

      const percentage =
        total > 0
          ? Math.round(
              (score / total) * 100
            )
          : 0;

      /* SAVE RESULT */

      const {
        data: result,
        error: resultError
      } =
        await supabase
          .from("results")
          .insert({
            exam_id:
              examId,

            student_name:
              String(
                student_name
              ).trim(),

            score,

            total,

            percentage,

            answers:
              safeAnswers
          })
          .select()
          .single();

      if (resultError) {

        console.error(
          "SAVE RESULT ERROR:",
          resultError
        );

        return res.status(500).json({
          error:
            resultError.message
        });
      }

      res.json({

        success: true,

        result: {

          id:
            result.id,

          student_name:
            String(
              student_name
            ).trim(),

          score,

          total,

          percentage,

          correct_count:
            correctCount,

          wrong_count:
            wrongCount,

          unanswered_count:
            unansweredCount,

          details
        }
      });

    } catch (error) {

      console.error(
        "SUBMIT ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   TEACHER RESULTS
========================= */

app.get(
  "/api/exams/:id/results",
  async (req, res) => {

    try {

      const examId =
        req.params.id;

      if (!isValidUUID(examId)) {

        return res.status(400).json({
          error:
            "ID qormaataa sirrii miti."
        });
      }

      /* QUESTIONS */

      const {
        data: questions,
        error: qError
      } =
        await supabase
          .from("questions")
          .select("*")
          .eq(
            "exam_id",
            examId
          )
          .order(
            "created_at",
            {
              ascending: true
            }
          );

      if (qError) {

        return res.status(500).json({
          error:
            qError.message
        });
      }

      /* RESULTS */

      const {
        data: results,
        error: rError
      } =
        await supabase
          .from("results")
          .select("*")
          .eq(
            "exam_id",
            examId
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (rError) {

        return res.status(500).json({
          error:
            rError.message
        });
      }

      const finalResults =
        (results || []).map(
          (result) => {

            const answers =
              result.answers &&
              typeof result.answers === "object"
                ? result.answers
                : {};

            let correctCount = 0;
            let wrongCount = 0;
            let unansweredCount = 0;

            const details =
              (questions || []).map(
                (q) => {

                  const hasAnswer =
                    answers[q.id] !== undefined &&
                    answers[q.id] !== null &&
                    String(
                      answers[q.id]
                    ).trim() !== "";

                  const studentAnswer =
                    hasAnswer
                      ? String(
                          answers[q.id]
                        ).trim()
                      : "";

                  const correctAnswer =
                    String(
                      q.correct_answer || ""
                    ).trim();

                  let status =
                    "unanswered";

                  if (!hasAnswer) {

                    unansweredCount++;

                    status =
                      "unanswered";

                  } else if (
                    normalizeAnswer(
                      studentAnswer
                    ) ===
                    normalizeAnswer(
                      correctAnswer
                    )
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

                    question_id:
                      q.id,

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
          }
        );

      res.json({
        results:
          finalResults
      });

    } catch (error) {

      console.error(
        "RESULTS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   DELETE QUESTION
========================= */

app.delete(
  "/api/questions/:id",
  async (req, res) => {

    try {

      const questionId =
        req.params.id;

      if (!isValidUUID(questionId)) {

        return res.status(400).json({
          error:
            "ID gaaffii sirrii miti."
        });
      }

      const {
        error
      } =
        await supabase
          .from("questions")
          .delete()
          .eq(
            "id",
            questionId
          );

      if (error) {

        return res.status(500).json({
          error:
            error.message
        });
      }

      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "DELETE QUESTION ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================
   404 API
========================= */

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({
      error:
        "API endpoint kana hin argamne."
    });
  }
);

/* =========================
   SERVER ERROR
========================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "SERVER ERROR:",
      error
    );

    res.status(500).json({
      error:
        "Server irratti dogoggorri uumame."
    });
  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `✅ Hidaayatul-Bayaan server running on port ${PORT}`
    );
  }
);

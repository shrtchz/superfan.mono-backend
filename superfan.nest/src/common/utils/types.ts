// types/quiz.types.ts
export interface QuizQuestion {
  id: string;
  testQuiz: string;
  earning: string;
  subject: string;
  testLevel: string;
  question: string;
  options: string[];
}

export interface UserAnswer {
  quizId: string;           // matches submit_format field name
  selectedAnswer: string;   // matches submit_format field name
  answeredAt: Date;
}
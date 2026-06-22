import { TestLevel } from '@prisma/client';

// quiz.events.ts
export class QuestionAddedEvent {
  constructor(
    public readonly subject: string,
    public readonly testQuiz: string, // language e.g. "yoruba"
    public readonly testLevel: TestLevel,
  ) {}
}
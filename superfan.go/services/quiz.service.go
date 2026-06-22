package services

import "quiz.superfan.com/apis/models"

type QuizService interface {
	// NORMAL QUIZ
	CreateQuiz(*models.Quiz) error
	GetQuiz(string) (*models.Quiz, error)
	GetAllQuiz() ([]*models.Quiz, error)
	UpdateQuiz(*models.Quiz) error
	DeleteQuiz(string) error

	// LIVE QUIZ
	GetQuizByPreferences(
		languagePreference string,
		subjectPreference string,
		testLevel string,
		questionPreference string,
		timePreference string,
	) (map[string]interface{}, error)

	SubmitQuiz(request models.SubmitQuizRequest) (map[string]interface{}, error)
	GetQuizAnswerById(id string) (map[string]interface{}, error)
	CreateLiveQuiz(*models.LiveQuiz) error
	GetLiveQuiz(string) (*models.LiveQuiz, error)
	GetRandomLiveQuiz(string) ([]models.LiveQuiz, error)
	GetAllLiveQuiz() ([]map[string]interface{}, error)
	GetLiveQuizAnswerById(id string) (map[string]interface{}, error)
	UpdateLiveQuiz(*models.LiveQuiz) error
	DeleteLiveQuiz(string) error

	// QUIZ CATEGORY
	CreateQuizCategory(category *models.QuizCategory) (*models.QuizCategory, error)
	GetAllCategory() ([]*models.QuizCategory, error)
	GetCategoryById(id string) (*models.QuizCategory, error)
}

type QuizSubmissionService interface {
	GetAllSubmissions() ([]models.QuizSubmission, error)
	GetUserSubmissions(userID string) ([]models.QuizSubmission, error)
}

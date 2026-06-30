package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/joho/godotenv/autoload"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
	"quiz.superfan.com/apis/utils"

	"quiz.superfan.com/apis/controllers"
	"quiz.superfan.com/apis/services"
)

var (
	server      *gin.Engine
	qs          services.QuizService
	qsc         *controllers.QuizSubmissionController
	qc          *controllers.QuizController
	ctx         context.Context
	mongoclient *mongo.Client
	err         error
)

type AppError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Config struct {
	Logs     LogConfig
	Port     string
	MongoURI string
}

type LogConfig struct {
	Style string
	Level string
}

func (e *AppError) Error() string {
	return e.Message
}

var (
	ErrNotFound     = &AppError{Status: 404, Code: "NOT_FOUND", Message: "resource not found"}
	ErrUnauthorized = &AppError{Status: 401, Code: "UNAUTHORIZED", Message: "authentication required"}
	ErrBadRequest   = &AppError{Status: 400, Code: "BAD_REQUEST", Message: "invalid request"}
)

// use os package to get the env variable which is already set
// func envVariable(key string) string {

//   // set env variable using os package
//   os.Setenv(key, "MONGO_URI")

//   // return the env variable using os package
//   return os.Getenv(key)
// }

// ErrorHandler is a middleware that catches errors set via c.Error().
func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) == 0 {
			return
		}

		err := c.Errors.Last().Err
		var appErr *AppError
		if errors.As(err, &appErr) {
			utils.SendError(c, appErr.Status, appErr.Code, appErr.Message)
		} else {
			utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "an unexpected error occurred")
		}
	}
}

func init() {
	utils.LoadEnv()
	get := utils.GetEnvWithKey
	mongoURI := get("MONGO_URI")

	if mongoURI == "" {
		log.Fatal("MONGO_URI environment variable is required")
	}

	ctx = context.Background()

	clientOptions := options.Client().ApplyURI(mongoURI)

	var mongoclient *mongo.Client
	var err error
	maxRetries := 10
	
	for i := 0; i < maxRetries; i++ {
		mongoclient, err = mongo.Connect(clientOptions)
		if err == nil {
			err = mongoclient.Ping(ctx, readpref.Primary())
			if err == nil {
				break
			}
		}
		log.Printf("Failed to connect to MongoDB, retrying in 2 seconds... (%d/%d)", i+1, maxRetries)
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		log.Fatal("error  while trying to ping/connect mongo after retries: ", err)
	}

	fmt.Println("mongo connection established")

	quizdb := mongoclient.Database("quizdb")

	quizc := quizdb.Collection("quiz")
	quizcategory := quizdb.Collection("quiz_category")
	liveQuizc := quizdb.Collection("livequiz")
	quizSubmissionc := quizdb.Collection("quiz_submissions")

	// Wire QuizService
	qs = services.NewQuizService(quizc, quizcategory, liveQuizc, quizSubmissionc, ctx)

	qsImpl, ok := qs.(*services.QuizServiceImpl)
	if !ok {
		log.Fatal("failed to assert QuizService to *QuizServiceImpl")
	}

	// Wire controllers
	qsc = controllers.NewQuizSubmissionController(qsImpl)
	qc = controllers.NewQuizController(qs)

	// Launch Airtable sync in the background
	go services.SyncFromAirtable(qs)

	server = gin.New()
	server.Use(gin.Logger())
	server.Use(gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		if err, ok := recovered.(string); ok {
			utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", err)
		} else {
			utils.SendError(c, http.StatusInternalServerError, "INTERNAL_SERVER_ERROR", "an unexpected error occurred")
		}
		c.AbortWithStatus(http.StatusInternalServerError)
	}))

	server.Use(ErrorHandler())
}

func main() {
	mode := os.Getenv("GIN_MODE")
	if mode != "" {
		gin.SetMode(mode)
	}

	defer mongoclient.Disconnect(ctx)

	server.GET("/health", func(c *gin.Context) {
		utils.Success(c, http.StatusOK, "UP", nil)
	})

	basepath := server.Group("/v1")

	controllers.RegisterQuizRoutes(
		basepath,
		qc,
		qsc,
	)

	port := os.Getenv("PORT")
	if port == "" {
		port = "7190"
	}

	log.Fatal(server.Run(":" + port))
}

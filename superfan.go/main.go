package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"

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
			c.JSON(appErr.Status, gin.H{
				"success": false,
				"error":   gin.H{"code": appErr.Code, "message": appErr.Message},
			})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   gin.H{"code": "INTERNAL", "message": "an unexpected error occurred"},
			})
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

	mongoclient, err = mongo.Connect(clientOptions)
	if err != nil {
		log.Fatal("error while connecting with mongo:", err)
	}

	err = mongoclient.Ping(ctx, readpref.Primary())
	if err != nil {
		log.Fatal("error while trying to ping mongo", err)
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

	server = gin.Default()

	server.Use(ErrorHandler())
}

func main() {
	mode := os.Getenv("GIN_MODE")
	if mode != "" {
		gin.SetMode(mode)
	}

	defer mongoclient.Disconnect(ctx)

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

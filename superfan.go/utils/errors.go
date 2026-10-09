package utils

type AppError struct {
	Status  int
	Code    string
	Message string
}

func (e *AppError) Error() string {
	return e.Message
}

func NewAppError(status int, code, message string) *AppError {
	return &AppError{Status: status, Code: code, Message: message}
}

// AppErrorWithData carries optional payload for structured error responses.
type AppErrorWithData struct {
	Status  int
	Code    string
	Message string
	Data    interface{}
}

func (e *AppErrorWithData) Error() string {
	return e.Message
}

func NewAppErrorWithData(status int, code, message string, data interface{}) *AppErrorWithData {
	return &AppErrorWithData{Status: status, Code: code, Message: message, Data: data}
}
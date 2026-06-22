package utils

import (
	"strconv"
)

func CalculateTotalEarning(quizzes []map[string]interface{}) int {
	total := 0
	for _, quiz := range quizzes {
		earningStr, ok := quiz["earning"].(string)
		if !ok {
			continue
		}
		earning, err := strconv.Atoi(earningStr)
		if err != nil {
			continue
		}
		total += earning
	}
	return total
}

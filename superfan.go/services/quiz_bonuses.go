package services

import "math"

func getAccuracyBonusPercent(correct int, total int) int {
	if total <= 0 {
		return 0
	}

	accuracy := (float64(correct) / float64(total)) * 100
	switch {
	case accuracy == 100:
		return 50
	case accuracy >= 95:
		return 25
	case accuracy >= 90:
		return 10
	default:
		return 0
	}
}

func getSpeedBonusPercent(quizTimeSeconds int) int {
	if quizTimeSeconds < 120 {
		return 50
	}
	if quizTimeSeconds < 180 {
		return 25
	}
	if quizTimeSeconds < 300 {
		return 10
	}
	return 0
}

func getStreakBonusPoints(dailyStreak int) int {
	return int(math.Round((float64(dailyStreak) / 7.0) * 1000.0))
}

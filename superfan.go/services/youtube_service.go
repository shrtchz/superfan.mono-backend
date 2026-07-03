package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/youtube/v3"

	"quiz.superfan.com/apis/models"
	"quiz.superfan.com/apis/utils"
)

type YouTubeService struct{}

func NewYouTubeService() *YouTubeService {
	return &YouTubeService{}
}

// GetClient retrieves the YouTube token from DB and initializes an authenticated YouTube API client.
func (s *YouTubeService) GetClient(ctx context.Context) (*youtube.Service, error) {
	if utils.DB == nil {
		return nil, errors.New("database connection not initialized")
	}

	var tokenRecord models.YouTubeToken
	if err := utils.DB.Where("service = ?", "youtube").First(&tokenRecord).Error; err != nil {
		return nil, fmt.Errorf("failed to retrieve youtube token from db: %w", err)
	}

	if tokenRecord.AccessToken == nil || tokenRecord.RefreshToken == nil {
		return nil, errors.New("incomplete youtube credentials in db")
	}

	config := &oauth2.Config{
		ClientID:     utils.GetEnvWithKey("GOOGLE_CLIENT_ID"),
		ClientSecret: utils.GetEnvWithKey("GOOGLE_CLIENT_SECRET"),
		Endpoint:     google.Endpoint,
	}

	token := &oauth2.Token{
		AccessToken:  *tokenRecord.AccessToken,
		RefreshToken: *tokenRecord.RefreshToken,
		TokenType:    "Bearer",
	}
	if tokenRecord.ExpiryDate != nil {
		token.Expiry = *tokenRecord.ExpiryDate
	}

	client := config.Client(ctx, token)

	ytService, err := youtube.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("failed to create youtube service: %w", err)
	}

	return ytService, nil
}

// CreateBroadcast creates a new YouTube live broadcast
func (s *YouTubeService) CreateBroadcast(ctx context.Context, title, description string) (*youtube.LiveBroadcast, error) {
	ytService, err := s.GetClient(ctx)
	if err != nil {
		return nil, err
	}

	broadcast := &youtube.LiveBroadcast{
		Snippet: &youtube.LiveBroadcastSnippet{
			Title:              title,
			Description:        description,
			ScheduledStartTime: time.Now().Add(1 * time.Minute).Format(time.RFC3339),
		},
		Status: &youtube.LiveBroadcastStatus{
			PrivacyStatus: "public",
		},
	}

	call := ytService.LiveBroadcasts.Insert([]string{"snippet", "status"}, broadcast)
	return call.Do()
}

// SetupStream creates a new YouTube live stream and binds it to a broadcast
func (s *YouTubeService) SetupStream(ctx context.Context, broadcastID, title string) (*youtube.LiveStream, error) {
	ytService, err := s.GetClient(ctx)
	if err != nil {
		return nil, err
	}

	stream := &youtube.LiveStream{
		Snippet: &youtube.LiveStreamSnippet{
			Title: title,
		},
		Cdn: &youtube.CdnSettings{
			FrameRate:     "30fps",
			IngestionType: "rtmp",
			Resolution:    "720p",
		},
	}

	call := ytService.LiveStreams.Insert([]string{"snippet", "cdn"}, stream)
	streamRes, err := call.Do()
	if err != nil {
		return nil, fmt.Errorf("failed to create live stream: %w", err)
	}

	// Bind the stream to the broadcast
	bindCall := ytService.LiveBroadcasts.Bind(broadcastID, []string{"id", "contentDetails"})
	bindCall = bindCall.StreamId(streamRes.Id)
	if _, err := bindCall.Do(); err != nil {
		return nil, fmt.Errorf("failed to bind stream to broadcast: %w", err)
	}

	return streamRes, nil
}

// TransitionBroadcast changes the status of a broadcast (e.g., to "live" or "complete")
func (s *YouTubeService) TransitionBroadcast(ctx context.Context, broadcastID, status string) (*youtube.LiveBroadcast, error) {
	ytService, err := s.GetClient(ctx)
	if err != nil {
		return nil, err
	}

	call := ytService.LiveBroadcasts.Transition(status, broadcastID, []string{"id", "status"})
	return call.Do()
}

// FetchChatMessages fetches live chat messages from a YouTube LiveChatId
func (s *YouTubeService) FetchChatMessages(ctx context.Context, liveChatId, pageToken string) (*youtube.LiveChatMessageListResponse, error) {
	ytService, err := s.GetClient(ctx)
	if err != nil {
		return nil, err
	}

	call := ytService.LiveChatMessages.List(liveChatId, []string{"snippet", "authorDetails"})
	if pageToken != "" {
		call = call.PageToken(pageToken)
	}

	return call.Do()
}

// GetVideoViews fetches the view count and statistics for a specific YouTube video ID
func (s *YouTubeService) GetVideoViews(ctx context.Context, videoID string) (*youtube.VideoListResponse, error) {
	ytService, err := s.GetClient(ctx)
	if err != nil {
		return nil, err
	}

	call := ytService.Videos.List([]string{"statistics", "snippet", "liveStreamingDetails", "status"})
	call = call.Id(videoID)
	return call.Do()
}

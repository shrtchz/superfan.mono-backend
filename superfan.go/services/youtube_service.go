package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
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

// CreateBroadcast creates a new YouTube live broadcast with embedding enabled
func (s *YouTubeService) CreateBroadcast(ctx context.Context, title, description string) (*youtube.LiveBroadcast, error) {
	ytService, err := s.GetClient(ctx)
	if err != nil {
		return nil, err
	}

	enableMonitorStream := true
	broadcast := &youtube.LiveBroadcast{
		Snippet: &youtube.LiveBroadcastSnippet{
			Title:              title,
			Description:        description,
			ScheduledStartTime: time.Now().Add(1 * time.Minute).Format(time.RFC3339),
		},
		Status: &youtube.LiveBroadcastStatus{
			PrivacyStatus:           "public",
			SelfDeclaredMadeForKids: false,
		},
		ContentDetails: &youtube.LiveBroadcastContentDetails{
			EnableEmbed:          true,
			EnableDvr:            true,
			RecordFromStart:      true,
			EnableClosedCaptions: false,
			EnableAutoStart:      false,
			EnableAutoStop:       false,
			MonitorStream: &youtube.MonitorStreamInfo{
				EnableMonitorStream:    &enableMonitorStream,
				BroadcastStreamDelayMs: 0,
			},
		},
	}
	// Ensure false booleans are sent (Go omits zero-values otherwise)
	broadcast.Status.ForceSendFields = []string{"SelfDeclaredMadeForKids"}
	broadcast.ContentDetails.ForceSendFields = []string{
		"EnableEmbed",
		"EnableDvr",
		"RecordFromStart",
		"EnableClosedCaptions",
		"EnableAutoStart",
		"EnableAutoStop",
	}
	broadcast.ContentDetails.MonitorStream.ForceSendFields = []string{
		"EnableMonitorStream",
		"BroadcastStreamDelayMs",
	}

	call := ytService.LiveBroadcasts.Insert([]string{"snippet", "status", "contentDetails"}, broadcast)
	result, err := call.Do()
	if err != nil {
		// Some channels reject enableEmbed=true; retry without forcing embed so creation still works
		errStr := err.Error()
		if strings.Contains(errStr, "invalidEmbedSetting") || strings.Contains(errStr, "enableEmbed") {
			fallback := &youtube.LiveBroadcast{
				Snippet: broadcast.Snippet,
				Status:  broadcast.Status,
			}
			result, err = ytService.LiveBroadcasts.Insert([]string{"snippet", "status"}, fallback).Do()
			if err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

	// Also mark the underlying video as embeddable (covers Studio "Allow embedding")
	if result != nil && result.Id != "" {
		if embedErr := s.ensureVideoEmbeddable(ytService, result.Id); embedErr != nil {
			fmt.Printf("warning: failed to set video embeddable for %s: %v\n", result.Id, embedErr)
		}
	}

	return result, nil
}

// EnsureEmbeddable enables embedding on an existing YouTube video/broadcast.
// Safe to call repeatedly; used after create and for older streams.
func (s *YouTubeService) EnsureEmbeddable(ctx context.Context, videoID string) error {
	if videoID == "" {
		return errors.New("videoId is required")
	}

	ytService, err := s.GetClient(ctx)
	if err != nil {
		return err
	}

	if err := s.ensureVideoEmbeddable(ytService, videoID); err != nil {
		return err
	}

	// Best-effort: also flip liveBroadcast contentDetails.enableEmbed
	if err := s.ensureBroadcastEmbed(ytService, videoID); err != nil {
		fmt.Printf("warning: ensureBroadcastEmbed for %s: %v\n", videoID, err)
	}

	return nil
}

// ensureVideoEmbeddable sets status.embeddable=true on the YouTube video/broadcast id
func (s *YouTubeService) ensureVideoEmbeddable(ytService *youtube.Service, videoID string) error {
	list, err := ytService.Videos.List([]string{"status"}).Id(videoID).Do()
	if err != nil {
		return err
	}
	if len(list.Items) == 0 {
		return fmt.Errorf("video %s not found", videoID)
	}

	existing := list.Items[0]
	if existing.Status != nil && existing.Status.Embeddable {
		return nil
	}

	privacy := "public"
	if existing.Status != nil && existing.Status.PrivacyStatus != "" {
		privacy = existing.Status.PrivacyStatus
	}

	video := &youtube.Video{
		Id: videoID,
		Status: &youtube.VideoStatus{
			Embeddable:    true,
			PrivacyStatus: privacy,
		},
	}
	video.Status.ForceSendFields = []string{"Embeddable"}

	_, err = ytService.Videos.Update([]string{"status"}, video).Do()
	return err
}

func (s *YouTubeService) ensureBroadcastEmbed(ytService *youtube.Service, broadcastID string) error {
	list, err := ytService.LiveBroadcasts.List([]string{"id", "snippet", "status", "contentDetails"}).Id(broadcastID).Do()
	if err != nil {
		return err
	}
	if len(list.Items) == 0 {
		return nil // not a live broadcast id — ignore
	}

	item := list.Items[0]
	if item.ContentDetails != nil && item.ContentDetails.EnableEmbed {
		return nil
	}

	enableMonitor := true
	update := &youtube.LiveBroadcast{
		Id: item.Id,
		Snippet: &youtube.LiveBroadcastSnippet{
			Title:              item.Snippet.Title,
			ScheduledStartTime: item.Snippet.ScheduledStartTime,
		},
		Status: &youtube.LiveBroadcastStatus{
			PrivacyStatus: item.Status.PrivacyStatus,
		},
		ContentDetails: &youtube.LiveBroadcastContentDetails{
			EnableEmbed: true,
			MonitorStream: &youtube.MonitorStreamInfo{
				EnableMonitorStream: &enableMonitor,
			},
		},
	}
	if item.ContentDetails != nil {
		update.ContentDetails.EnableDvr = item.ContentDetails.EnableDvr
		update.ContentDetails.RecordFromStart = item.ContentDetails.RecordFromStart
		update.ContentDetails.EnableClosedCaptions = item.ContentDetails.EnableClosedCaptions
		update.ContentDetails.EnableAutoStart = item.ContentDetails.EnableAutoStart
		update.ContentDetails.EnableAutoStop = item.ContentDetails.EnableAutoStop
		if item.ContentDetails.MonitorStream != nil {
			update.ContentDetails.MonitorStream = item.ContentDetails.MonitorStream
		}
	}
	update.ContentDetails.ForceSendFields = []string{"EnableEmbed"}

	_, err = ytService.LiveBroadcasts.Update([]string{"id", "snippet", "status", "contentDetails"}, update).Do()
	return err
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

	// Re-assert embedding after bind (video record is fully available then)
	if embedErr := s.EnsureEmbeddable(ctx, broadcastID); embedErr != nil {
		fmt.Printf("warning: EnsureEmbeddable after setup for %s: %v\n", broadcastID, embedErr)
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';
import { prisma } from '../prisma/prisma';
import { CreatePodcastDto, UpdatePodcastDto } from './podcast.dto';

@Injectable()
export class PodcastService {
  constructor(private readonly notificationService: NotificationService) {}

  listPublished() { return prisma.podcast.findMany({ where: { publishedAt: { not: null }, uploadStatus: 'READY', privacyStatus: 'public' }, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }] }); }
  listAdmin() { return prisma.podcast.findMany({ orderBy: { createdAt: 'desc' } }); }
  async create(createdById: number, dto: CreatePodcastDto) {
    const publishedAt = dto.privacyStatus === 'public' && dto.uploadStatus === 'READY' ? new Date() : null;
    const episode = await prisma.podcast.create({ data: { ...dto, createdById, privacyStatus: dto.privacyStatus || 'private', uploadStatus: dto.uploadStatus || 'PROCESSING', publishedAt } });
    // "🎧 "<title>" just dropped." — fired when a new episode is published
    if (episode?.publishedAt) {
      await this.notifyNewEpisode(episode.title).catch(() => null);
    }
    return episode;
  }
  async update(id: number, dto: UpdatePodcastDto) {
    const current = await prisma.podcast.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Podcast not found');
    const privacyStatus = dto.privacyStatus || current.privacyStatus;
    const uploadStatus = dto.uploadStatus || current.uploadStatus;
    const episode = await prisma.podcast.update({ where: { id }, data: { ...dto, publishedAt: privacyStatus === 'public' && uploadStatus === 'READY' ? (current.publishedAt || new Date()) : null } });
    // "🎧 "<title>" just dropped." — fired when an episode flips to published
    if (episode?.publishedAt && !current?.publishedAt) {
      await this.notifyNewEpisode(episode.title).catch(() => null);
    }
    return episode;
  }
  async remove(id: number) { await this.update(id, {}); return prisma.podcast.delete({ where: { id } }); }

  private async notifyNewEpisode(episodeTitle: string) {
    const userIds = (
      await prisma.user.findMany({
        where: { roleName: 'client' },
        select: { id: true },
        take: 5000,
      })
    ).map((u) => u.id);
    if (!userIds.length) return;
    await this.notificationService.podcastNewEpisode(userIds, episodeTitle);
  }
}

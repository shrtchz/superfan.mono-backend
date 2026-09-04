import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { CreatePodcastDto, UpdatePodcastDto } from './podcast.dto';

@Injectable()
export class PodcastService {
  listPublished() { return prisma.podcast.findMany({ where: { publishedAt: { not: null }, uploadStatus: 'READY', privacyStatus: 'public' }, orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }] }); }
  listAdmin() { return prisma.podcast.findMany({ orderBy: { createdAt: 'desc' } }); }
  create(createdById: number, dto: CreatePodcastDto) {
    const publishedAt = dto.privacyStatus === 'public' && dto.uploadStatus === 'READY' ? new Date() : null;
    return prisma.podcast.create({ data: { ...dto, createdById, privacyStatus: dto.privacyStatus || 'private', uploadStatus: dto.uploadStatus || 'PROCESSING', publishedAt } });
  }
  async update(id: number, dto: UpdatePodcastDto) {
    const current = await prisma.podcast.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Podcast not found');
    const privacyStatus = dto.privacyStatus || current.privacyStatus;
    const uploadStatus = dto.uploadStatus || current.uploadStatus;
    return prisma.podcast.update({ where: { id }, data: { ...dto, publishedAt: privacyStatus === 'public' && uploadStatus === 'READY' ? (current.publishedAt || new Date()) : null } });
  }
  async remove(id: number) { await this.update(id, {}); return prisma.podcast.delete({ where: { id } }); }
}

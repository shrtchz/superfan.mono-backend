import { Client } from '@elastic/elasticsearch';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  public client: Client;

  async onModuleInit() {
    const node = process.env.LOCAL_ELASTICSEARCH_URL || process.env.PROD_ELASTICSEARCH_URL;
    if (!node) {
      this.logger.warn('Elasticsearch is not configured (missing LOCAL_ELASTICSEARCH_URL or PROD_ELASTICSEARCH_URL). Skipping initialization.');
      return;
    }

    try {
      this.client = new Client({
        node,
        auth: {
          username: process.env.LOCAL_ELASTICSEARCH_USERNAME || process.env.PROD_ELASTICSEARCH_USERNAME,
          password: process.env.LOCAL_ELASTICSEARCH_PASSWORD || process.env.PROD_ELASTICSEARCH_PASSWORD,
        },
        tls: {
          rejectUnauthorized: false, // for local self-signed cert
        },
      });

      await this.ensureIndex();
      this.logger.log('Elasticsearch connected and indices verified.');
    } catch (err) {
      // A bad/misconfigured ES URL (e.g. pointing at a Cloudflare proxy) throws
      // ProductNotSupportedError and would crash the whole NestJS bootstrap.
      // We degrade gracefully instead: reset the client so all `if (!this.client)`
      // guards in the service return early without erroring.
      this.client = null;
      this.logger.error(
        `Elasticsearch initialisation failed — running without search. Reason: ${err?.message ?? err}`,
      );
    }
  }

  private async ensureIndex() {
    if (!this.client) return;
    const indices = ['users', 'comments'];

    for (const index of indices) {
      try {
        const exists = await this.client.indices.exists({ index });

        if (!exists) {
          if (index === 'users') {
            await this.client.indices.create({
              index,
              mappings: {
                properties: {
                  id: { type: 'keyword' },
                  username: { type: 'search_as_you_type' },
                  email: { type: 'keyword' },
                  createdAt: { type: 'date' },
                },
              },
            });
          }

          if (index === 'comments') {
            await this.client.indices.create({
              index,
              mappings: {
                properties: {
                  id: { type: 'keyword' },
                  streamId: { type: 'integer' },
                  parentId: { type: 'keyword' }, // null for comments, comment id for replies
                  content: {
                    type: 'search_as_you_type',
                  },
                  type: {
                    type: 'keyword', // comment | reply
                  },
                  createdAt: {
                    type: 'date',
                  },
                },
              },
            });
          }

          this.logger.log(`Index "${index}" created`);
        }
      } catch (err) {
        this.logger.error(`Failed to ensure index "${index}": ${err?.message ?? err}`);
        throw err; // re-throw so onModuleInit catch can reset this.client
      }
    }
  }


  /** Upsert a user document into ES when created/updated via Prisma */
  async indexUser(user: { id: number; username: string; email?: string; createdAt?: Date }) {
    if (!this.client) return;
    await this.client.index({
      index: 'users',
      id: user.id.toString(),
      document: user,
    });
  }

  /** Search usernames — supports prefix/fuzzy matching */
  async searchUsers(query: string, size = 10) {
    if (!this.client) return [];
    const { hits } = await this.client.search({
      index: 'users',
      size,
      query: {
        multi_match: {
          query,
          type: 'bool_prefix',          // "search as you type"
          fields: [
            'username',
            // 'username._2gram',
            // 'username._3gram',
          ],
          fuzziness: 'AUTO',            // handles typos
        },
      },
    });

    return hits.hits.map((hit) => hit._source);
  }

  async indexComment(comment: {
    id: number;
    streamId: number;
    content: string;
    parentId?: string | null;
    createdAt?: Date;
  }) {
    if (!this.client) return;
    await this.client.index({
      index: 'comments',
      id: comment.id.toString(),
      document: {
        id: comment.id,
        streamId: comment.streamId,
        content: comment.content,
        parentId: comment.parentId ?? null,
        type: comment.parentId ? 'reply' : 'comment',
        createdAt: comment.createdAt,
      },
      refresh: true,
    });
  }

  async searchCommentAndReply(
    streamId: number,
    query: string,
    size = 50,
  ) {
    if (!this.client) return [];
    const { hits } = await this.client.search({
      index: 'comments',
      size,
      query: {
        bool: {
          filter: [
            {
              term: {
                streamId,
              },
            },
          ],
          must: [
            {
              multi_match: {
                query,
                type: 'bool_prefix',
                fields: [
                  'content',
                  'content._2gram',
                  'content._3gram',
                ],
                fuzziness: 'AUTO',
              },
            },
          ],
        },
      },
    });

    return hits.hits.map((hit) => hit._source);
  }
}
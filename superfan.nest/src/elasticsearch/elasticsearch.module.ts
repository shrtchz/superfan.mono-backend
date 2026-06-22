import { Global, Module } from '@nestjs/common';
import { AirtableService } from './airtable.service';
import { ElasticsearchService } from './elasticsearch.service';

@Global()
@Module({
  providers: [ElasticsearchService, AirtableService],
  exports: [ElasticsearchService, AirtableService],
})
export class ElasticsearchModule {}
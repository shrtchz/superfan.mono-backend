import { Injectable } from '@nestjs/common';
import { airtabler } from '@superbasicxyz/airtabler';

@Injectable()
export class AirtableService {
  private readonly db;

  constructor() {
    this.db = airtabler.init({
      apiKey: process.env.AIRTABLE_API_KEY!,
      baseId: process.env.AIRTABLE_BASE_ID!,
    });

    console.log('AirtableService initialized with base ID:', process.env.AIRTABLE_BASE_ID);
  }

 

  

  /**
   * Get a single record by ID
   */
  async findOne(tableName: string, recordId: string) {
    return await this.db.table(tableName).find(recordId);
  }

  /**
   * Get all records
   */
  async findAll(tableName: string) {
    console.log(await this.db);
    return await this.db.table(tableName).select();
  }

  /**
   * Get records with limit
   */
  async findPage(tableName: string, limit = 50) {
    return await this.db.table(tableName).select({
      maxRecords: limit,
    });
  }

  /**
   * Create record
   */
  async create(
    tableName: string,
    fields: Record<string, any>,
  ) {
    return await this.db.table(tableName).create(fields);
  }

  /**
   * Update record
   */
  async update(
    tableName: string,
    recordId: string,
    fields: Record<string, any>,
  ) {
    return await this.db.table(tableName).update(recordId, fields);
  }

  /**
   * Delete record
   */
  async delete(
    tableName: string,
    recordId: string,
  ) {
    return await this.db.table(tableName).delete(recordId);
  }
}
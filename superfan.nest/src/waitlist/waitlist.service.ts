import { google } from 'googleapis';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JoinWaitlistDto } from './dto/waitlist.dto';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(private readonly configService: ConfigService) {}

  async joinWaitlist(dto: JoinWaitlistDto) {
    const clientEmail = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');
    const spreadsheetId = this.configService.get<string>('GOOGLE_SHEET_ID');
    const tabName = this.configService.get<string>('GOOGLE_SHEET_TAB_NAME') || 'Sheet1';

    if (!clientEmail || !privateKey || !spreadsheetId) {
      this.logger.warn('Google Sheet credentials are not fully configured in environment variables.');
      return {
        success: true,
        message: 'Successfully joined waitlist (mock mode - credentials missing).',
      };
    }

    try {
      const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tabName}!A:E`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [
            [
              dto.fullName,
              dto.email,
              dto.phone || '—',
              dto.hearAbout || '—',
              new Date().toISOString(),
            ],
          ],
        },
      });

      this.logger.log(`Successfully added ${dto.email} to Google Sheet waitlist.`);
      return {
        success: true,
        message: 'Successfully joined waitlist.',
      };
    } catch (error) {
      this.logger.error(`Failed to write to Google Sheets: ${error.message}`);
      throw error;
    }
  }
}

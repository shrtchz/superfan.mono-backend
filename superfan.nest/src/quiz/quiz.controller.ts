import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public, Roles } from '../common/decorators';
import { ApiRoutes } from '../common/enums/routes.enum';
import { Role } from '../common/enums/role.enum';
import { JwtGuard } from '../common/guards';
import { RoleGuard } from '../common/guards/roles.guard';
import { failureResponse, successResponse } from '../common/interceptors/response.interceptor';

import {
  CreateLiveQuizDto,
  CreateQuizCategoryDto,
  CreateQuizDto,
  GetQuizWithPreferencesDto,
  RecordAnswerDto,
  SubmitLiveAnswerDto,
  SubmitQuizDto,
  startRandomQuiz,
  UpdateLiveAnswerDto,
  UpdateLiveQuizDto,
} from './quiz.dto';
import { QuizService } from './quiz.service';

@UseGuards(JwtGuard)
@Controller(ApiRoutes.QUIZ)
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Public()
  @Post('/create')
  createQuiz(@Body() quizData: CreateQuizDto) {
    try {
      return this.quizService.createQuiz(quizData);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to create quiz');
    }
  }

  @Public()
  @Post('/create-live-quiz')
  createLiveQuiz(@Body() liveQuizData: CreateLiveQuizDto) {
    try {
      return this.quizService.createLiveQuiz(liveQuizData);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to create live quiz');
    }
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Post('live')
  createLiveQuizSpec(@Body() liveQuizData: CreateLiveQuizDto) {
    try {
      return this.quizService.createLiveQuiz(liveQuizData);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to create live quiz');
    }
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Patch('live/:id')
  async updateLiveQuizSpec(
    @Param('id') id: string,
    @Body() updateData: UpdateLiveQuizDto,
  ) {
    try {
      return await this.quizService.updateLiveQuiz(updateData, id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw failureResponse(error.message || 'Failed to update live quiz');
    }
  }

  @UseGuards(RoleGuard)
  @Roles(Role.superadmin, Role.subadmin, Role.moderator)
  @Delete('live/:id')
  async deleteLiveQuizSpec(@Param('id') id: string) {
    try {
      return await this.quizService.deleteLiveQuiz(id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw failureResponse(error.message || 'Failed to delete live quiz');
    }
  }

  @Post('/submit-quiz')
  async submitQuiz(@Body() body: SubmitQuizDto) {
    const { userId, rewardType, quizTime, responses, ad_bonuses = 0 } = body;
    return this.quizService.submitQuiz(
      userId,
      rewardType,
      quizTime,
      ad_bonuses,
      responses,
    );
  }

    @Post('submit/:userId')
  async submitLiveQuiz(
    @Param('userId') userId: string,
  ) {
    const data =
      await this.quizService.submitLiveQuiz(
        userId,
      );

    return {
      data,
      message: 'Live quiz submitted successfully',
    };
  }

      @Post('quit')
  async quitQuiz(
    @Query('userId') userId: number,
    @Query('rewardType') rewardType: string,
    @Query('quizTime') quizTime: string,
    @Query('ad_bonuses') ad_bonuses: number
  ) {
    const data =
      await this.quizService.quitQuiz(
        userId,
        rewardType,
        quizTime,
        ad_bonuses
      );

    return {
      data,
      message: 'Live quiz submitted successfully',
    };
  }

  @Get('quick-start')
  async getQuizWithPreferences(@Query() dto: GetQuizWithPreferencesDto, @Req() req: any) {
    try {
      return await this.quizService.getQuizWithPreferences(dto, req.user.id);
    } catch (error) {
      console.error('CRITICAL Error fetching quiz with preferences:', error);
      if (error.response) {
        console.error('CRITICAL Axios Response Data:', error.response.data);
      }
      throw failureResponse(
        error || 'Failed to get quiz with preferences',
      );
    }
  }

  /**
   * Start a quick-start session with a quiz pack already loaded from Go.
   * Body: { quizzes, totalEarning?, totalTime?, languagePreference?, ... , isRandom? }
   */
  @Post('start-quick-session')
  async startQuickSession(
    @Body()
    body: {
      quizzes?: any[];
      totalEarning?: number;
      totalTime?: number;
      languagePreference?: string;
      subjectPreference?: string;
      testLevel?: string;
      isRandom?: boolean | string;
      [key: string]: any;
    },
    @Req() req: any,
  ) {
    try {
      const isRandom =
        body.isRandom === true ||
        body.isRandom === 'true' ||
        body.isRandom === '1';
      const replaceExisting =
        body.replaceExisting === true ||
        body.replaceExisting === 'true' ||
        body.replaceExisting === '1';
      const { isRandom: _ignored, replaceExisting: _replaceIgnored, ...pack } =
        body;
      return await this.quizService.startQuickQuizSession(
        req.user.id,
        pack,
        isRandom,
        replaceExisting,
      );
    } catch (error) {
      throw failureResponse(
        error || 'Failed to start quick quiz session',
      );
    }
  }


    @Post('start-test')
    @HttpCode(HttpStatus.OK)
  async getQuizStarted(@Query() dto: startRandomQuiz) {
    try {
      return await this.quizService.startRandomQuiz(dto);
    } catch (error) {
      console.log('Error fetching quiz with preferences:', error);
      throw failureResponse(
        error || 'Failed to get quiz with preferences',
      );
    }
  }

      @Get('gq-leaderboard')
  async getGeneralQuizLeaderboard(
      @Query('filter')
  filter: 'all' | 'today' | 'weekly' | 'monthly',
  ) {
    try {
      return await this.quizService.getQuizleaderboard(filter);
    } catch (error) {
      console.log('Error fetching general quiz leaderboard:', error);
      throw failureResponse(
        error || 'Failed to get general quiz leaderboard',
      );
    }
  }

    @Get('lq-leaderboard')
  async getLiveQuizLeaderboard() {
    try {
      return await this.quizService.getLiveQuizLeaderboard();
    } catch (error) {
      console.log('Error fetching live quiz leaderboard:', error);
      throw failureResponse(
        error || 'Failed to get live quiz leaderboard',
      );
    }
  }

      @Get('ongoing-live-quiz')
  async getAllOngoingLiveQuiz() {
    try {
      return await this.quizService.fetchAllLiveQuiz();
    } catch (error) {
      console.log('Error fetching ongoing live quiz leaderboard:', error);
      throw failureResponse(
        error || 'Failed to get ongoing live quiz leaderboard',
      );
    }
  }

@Public()
@Get('/get-ongoing-quiz/:id')
async getOngoingQuiz(@Param('id', ParseIntPipe) id: number) {
  try {
    const result = await this.quizService.fetchOngoingQuiz(id);

    if (!result) {
      throw new HttpException(
        { message: 'No ongoing quiz found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    if ('expired' in result && result.expired) {
      throw new HttpException(
        { expired: true, message: result.message },
        HttpStatus.GONE,
      );
    }

    return successResponse('Ongoing quiz fetched successfully', result);
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw failureResponse(error.message || 'Failed to get ongoing quiz');
  }
}

@Get('completed-quiz')
async getCompletedQuiz() {
  try {
    const result = await this.quizService.getAllCompletedQuiz();
    return successResponse('Completed quiz fetched successfully', result);
  } catch(error) {
    throw failureResponse(error.message || 'Failed to get completed quiz.')
  }
}

    @Get(':streamId/:userId/submitted')
  async hasSubmittedLiveQuizForStream(@Query('streamId') streamId: number, @Query('userId') userId: number) {
    return this.quizService.hasSubmittedLiveQuizForStream(streamId, userId);
  }


@Public()
@Get('/get-quiz-result/:userId')
async getQuizResult(@Param('userId', ParseIntPipe) userId: number) {
  try {
    const result = await this.quizService.getQuizResult(userId);

    if (!result) {
      throw new HttpException(
        { message: 'No quiz result found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    return successResponse('Quiz result fetched successfully', result);
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw failureResponse(error || 'Failed to get quiz result');
  }
}

@Public()
@Get('/get-ongoing-live-quiz/:id')
async getOngoingLiveQuiz(@Param('id', ParseIntPipe) id: number) {
  try {
    const result = await this.quizService.fetchOngoingLiveQuiz(id);

    if (!result) {
      throw new HttpException(
        { message: 'No ongoing live quiz found.' },
        HttpStatus.NOT_FOUND,
      );
    }

    return successResponse('Ongoing live quiz fetched successfully', result);
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw failureResponse(error.message || 'Failed to get ongoing live quiz');
  }
}

  @Public()
  @Get('/get-completed/:streamId')
  getCompletedLiveQuizWithStreamId(@Param('streamId') streamId: number) {
    try {
      return this.quizService.getCompletedLiveQuizWithStreamId(streamId);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get live quiz');
    }
  }

  @Public()
  @Get('/get-live-quiz/:id')
  getLiveQuiz(@Param('id') id: string) {
    try {
      return this.quizService.getLiveQuiz(id);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get live quiz');
    }
  }


    @Public()
  @Get('/get-live-quiz-answer/:id')
  getCompletedLiveQuizAnswer(@Param('id') id: string) {
    try {
      return this.quizService.getLiveQuizAnswer(id);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get live quiz answer');
    }
  }

  @Get('/get-random-live-quiz/:id/:streamId')
  getRandomLiveQuiz(@Param('id', ParseIntPipe) id: number, @Param('streamId', ParseIntPipe) streamId: number, @Req() req: any) {
    try {
      return this.quizService.getRandomLiveQuiz(id, streamId, req.user.id);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get live quiz');
    }
  }

  /**
   * Start a live quiz session with questions already loaded from Go.
   * Body: { streamId: number, questions: GoLiveQuiz[] }
   */
  @Post('/start-live-session')
  startLiveSession(
    @Body()
    body: {
      streamId: number;
      questions: any[];
    },
    @Req() req: any,
  ) {
    try {
      return this.quizService.startLiveQuizSession(
        req.user.id,
        Number(body.streamId),
        body.questions || [],
      );
    } catch (error) {
      throw failureResponse(error.message || 'Failed to start live quiz session');
    }
  }

    @Put('live-quiz-answer')
  async updateAnswer(
    @Req() req: any,
    @Body() dto: UpdateLiveAnswerDto,
  ) {
    const data =
      await this.quizService.updateLiveQuizAnswer(
        dto,
        req.user.id,
      );

    return {
      data,
    };
  }

  @Post('live/:id/answer')
  async submitLiveAnswerByQuizId(
    @Req() req: any,
    @Param('id') quizId: string,
    @Body() dto: SubmitLiveAnswerDto,
  ) {
    const data = await this.quizService.submitLiveAnswerByQuizId(
      req.user.id,
      quizId,
      dto.selectedAnswer,
    );

    return {
      data,
      message: 'Live quiz answer submitted',
    };
  }

  @Public()
  @Get('/get-quiz-answer/:id')
  async getQuizAnswer(@Param('id') id: string) {
    try {
      return await this.quizService.getQuizAnswer(id);
    } catch (error) {
      throw failureResponse(error || 'Failed to get quiz answer');
    }
  }

    @Patch('ongoing/answer')
  @HttpCode(HttpStatus.OK)
  async recordAnswer(@Req() req, @Body() dto: RecordAnswerDto) {
    return this.quizService.recordAnswer(req.user.id, dto);
  }

  // Get current answers in submit_format shape
  @Get('ongoing/answers')
  async getOngoingQuizAnswers(@Req() req) {
    return this.quizService.getOngoingQuizAnswers(req.user.id);
  }

  @Public()
  @Get('/getall-categories')
  getAllCategories() {
    try {
      return this.quizService.getAllCategory();
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get all categories');
    }
  }

  @Public()
  @Get('/getall-live-quiz')
  getAllLiveQuiz() {
    try {
      return this.quizService.getAllLiveQuiz();
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get all live quizzes');
    }
  }

  @Public()
  @Patch('/update/:id')
  async updateLiveQuiz(@Param('id') id: string, @Body() updateData: any) {
    try {
      return await this.quizService.updateLiveQuiz(updateData, id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw failureResponse(error.message || 'Failed to update live quiz');
    }
  }

  @Public()
  @Delete('/delete-live-quiz/:id')
  async deleteLiveQuiz(@Param('id') id: string) {
    try {
      return await this.quizService.deleteLiveQuiz(id);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw failureResponse(error.message || 'Failed to delete live quiz');
    }
  }

  @Public()
  @Post('/create-category')
  createQuizCategory(@Body() quizcategory: CreateQuizCategoryDto) {
    try {
      return this.quizService.createQuizCategory(quizcategory);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to create quiz category');
    }
  }

  @Public()
  @Get('/get/:id')
  getQuiz(@Param('id') id: string) {
    try {
      return this.quizService.getQuiz(id);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get quiz');
    }
  }

  @Public()
  @Get('/get-submissions/:id')
  getQuizSubmissionbyUserId(@Param('id') id: string) {
    try {
      return this.quizService.getQuizSubmissionByUserId(id);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to get quiz submissions');
    }
  }

  @Public()
  @Get('/getall-submissions')
  getAllQuizSubmissions() {
    try {
      return this.quizService.getAllQuizSubmissions();
    } catch (error) {
      throw failureResponse(
        error.message || 'Failed to get all quiz submissions',
      );
    }
  }

  

  @Public()
  @Get('/getall')
  async getAllQuiz() {
    try {
      return await this.quizService.getAllQuiz();
    } catch (error) {
      if (error.response && error.response.data) {
        throw new HttpException(error.response.data, error.response.status);
      }
      throw failureResponse(
        error.message || 'Failed to get all quizzes',
      );
    }
  }

  @Public()
  @Patch('update-quiz/:id')
  async updateQuiz(@Param('id') id: string, @Body() updateData: any) {
    try {
      return this.quizService.updateQuiz(id, updateData);
    } catch (error) {
      throw failureResponse(
        error.message || 'Failed to get all quiz submissions',
      );
    }
  }

  @Public()
  @Delete('/delete/:id')
  deleteQuiz(@Param('id') id: string) {
    try {
      return this.quizService.deleteQuiz(id);
    } catch (error) {
      throw failureResponse(error.message || 'Failed to delete quiz.');
    }
  }
}

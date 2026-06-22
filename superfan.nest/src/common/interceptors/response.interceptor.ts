import { InternalServerErrorException, NotFoundException } from "@nestjs/common";

export function successResponse(message: string, result: any = []) {
    return {
        status: 'success',
        message,
        result
    }
}

export function failureResponse(error: any) {
    if(error.response && error.response.statusCode) {
        return error;
    }

    if(error.message.includes('connect ECONNREFUSED')) {
        return new NotFoundException(`Poor internet connection | Unauthorized WI-FI access | Server is down`);
    }

    if (error.message.includes('connect ETIMEDOUT')) {
        return new NotFoundException(`Request timed out. Please check your internet connection and try again.`);
    }

    return new InternalServerErrorException(error.message);
}
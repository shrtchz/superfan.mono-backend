import { HttpException, InternalServerErrorException, NotFoundException } from "@nestjs/common";

export function successResponse(message: string, result: any = []) {
    return {
        status: 'success',
        message,
        result
    }
}

function getFullErrorMessage(error: any): string {
    if (!error) return 'Unknown error';

    if (error instanceof Error) {
        return error.stack ? `${error.message}\n${error.stack}` : error.message;
    }

    if (typeof error === 'string') return error;

    const parts: string[] = [];
    const candidateMessages = [
        error.message,
        error?.cause?.message,
        error?.cause?.originalMessage,
        error?.response?.data?.message,
        error?.response?.message,
        error?.error?.message,
        error?.originalError?.message,
    ];

    for (const part of candidateMessages) {
        if (typeof part === 'string' && part.trim()) {
            parts.push(part.trim());
        }
    }

    if (parts.length) return parts.join(' | ');

    try {
        return JSON.stringify(error, null, 2);
    } catch {
        return String(error);
    }
}

export function failureResponse(error: any) {
    if (error instanceof HttpException) {
        return error;
    }

    if (error?.response && error.response.statusCode) {
        return error;
    }

    const fullMessage = getFullErrorMessage(error);

    if (typeof fullMessage === 'string' && fullMessage.includes('connect ECONNREFUSED')) {
        return new NotFoundException(`Poor internet connection | Unauthorized WI-FI access | Server is down`);
    }

    if (typeof fullMessage === 'string' && fullMessage.includes('connect ETIMEDOUT')) {
        return new NotFoundException(`Request timed out. Please check your internet connection and try again.`);
    }

    return new InternalServerErrorException({
        message: fullMessage,
        error: fullMessage,
        statusCode: 500,
    });
}
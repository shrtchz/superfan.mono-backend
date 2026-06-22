import { IsArray, IsString } from "class-validator";

export class SendToAllUsersDto {
    @IsString()
  title: string;

   @IsString()
  message: string;
}

export class SendToUsersDto {
     @IsArray()
  userIds: number[];


  @IsString()
  title: string;

  @IsString()
  message: string;
}
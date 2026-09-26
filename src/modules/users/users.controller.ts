import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('view')
  findAll() {
    return this.usersService.findAll();
  }

  @Get('view/:id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post('add')
  @HttpCode(HttpStatus.OK)
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Put('update/:id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Get('profile/:idOrUsername')
  getProfile(
    @Param('idOrUsername') idOrUsername: string,
    @Query('currentUserId') currentUserId?: string,
  ) {
    return this.usersService.getProfile(idOrUsername, currentUserId);
  }

  @Put('profile/:id')
  updateProfile(@Param('id') id: string, @Body() updateData: any) {
    return this.usersService.updateProfile(id, updateData);
  }

  @Post('follow/:targetId')
  @HttpCode(HttpStatus.OK)
  toggleFollow(
    @Param('targetId') targetId: string,
    @Body('currentUserId') currentUserId: string,
  ) {
    return this.usersService.toggleFollow(currentUserId, targetId);
  }

  @Delete('delete/:id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}

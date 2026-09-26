import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findAll(): Promise<{ users: User[] }> {
    try {
      const users = await this.userModel.find().select(['-password']).exec();
      return { users };
    } catch (error) {
      throw new NotFoundException([]);
    }
  }

  async findOne(id: string): Promise<{ user: User }> {
    try {
      const user = await this.userModel.findById(id).exec();
      return { user };
    } catch (error) {
      throw new NotFoundException({});
    }
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async create(createUserDto: CreateUserDto): Promise<string> {
    const { firstName, lastName, username, email, password } = createUserDto;
    const existingUser = await this.userModel.findOne({ email }).exec();
    if (existingUser) {
      throw new BadRequestException('Already Registerd');
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = new this.userModel({
        firstName,
        lastName,
        username,
        email,
        password: hashedPassword,
      });
      await user.save();
      return 'User Registered Successfully';
    } catch (error) {
      throw new InternalServerErrorException('Unable to Register, Try Again!');
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<string> {
    try {
      const updateData = { ...updateUserDto };
      if (updateData.password) {
        updateData.password = await bcrypt.hash(updateData.password, 10);
      }
      await this.userModel.updateOne({ _id: id }, updateData).exec();
      return 'Updated Users';
    } catch (error) {
      throw new NotFoundException('Unable to Update, Try Again!');
    }
  }

  async remove(id: string): Promise<string> {
    try {
      await this.userModel.deleteOne({ _id: id }).exec();
      return 'deleted Successfully';
    } catch (error) {
      throw new NotFoundException('Unable to Delete, Try Again!');
    }
  }
}

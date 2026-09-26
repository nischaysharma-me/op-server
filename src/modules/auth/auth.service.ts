import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users/schemas/user.schema';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;
    const user = await this.userModel.findOne({ email }).exec();

    if (!user) {
      throw new NotFoundException({ error: 'Invalid email and password!' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new BadRequestException({
        stat: 'failure',
        error: 'Invalid Email and Password',
      });
    }

    const payload = { _id: user._id };
    const token = this.jwtService.sign(payload);
    const { _id, firstName, lastName, username } = user;

    return {
      stat: 'success',
      token,
      user: {
        _id,
        firstName,
        lastName,
        username,
        email: user.email,
      },
    };
  }

  logout() {
    return {
      message: 'User signout successfully',
    };
  }
}

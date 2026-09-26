import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './schemas/user.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Issue.name) private readonly issueModel: Model<IssueDocument>,
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
      const user = await this.userModel.findById(id).select(['-password']).exec();
      if (!user) throw new NotFoundException('User not found');
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

  /**
   * Comprehensive Profile retrieval: user info + authored troubles/posts + social stats
   */
  async getProfile(idOrUsername: string, currentUserId?: string) {
    let user: UserDocument | null = null;

    if (Types.ObjectId.isValid(idOrUsername)) {
      user = await this.userModel.findById(idOrUsername).select(['-password']).exec();
    }

    if (!user) {
      user = await this.userModel.findOne({ username: idOrUsername }).select(['-password']).exec();
    }

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const userIdStr = (user as any)._id.toString();

    // Fetch troubles / discussions posted by this user
    const posts = await this.issueModel
      .find({
        $or: [
          { creator: userIdStr },
          { creator: user.username },
        ],
      })
      .sort({ createdAt: -1 })
      .exec();

    const isFollowing = currentUserId
      ? (user.followers || []).includes(currentUserId)
      : false;

    return {
      user: {
        _id: (user as any)._id,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        username: user.username || '',
        email: user.email,
        avatarUrl: user.avatarUrl || `https://api.dicebear.com/7.x/identicon/svg?seed=${user.username || user.email}`,
        bio: user.bio || '',
        headline: user.headline || '',
        location: user.location || '',
        website: user.website || '',
        interests: user.interests || [],
        reputation: user.reputation || 0,
        createdAt: (user as any).createdAt,
      },
      posts,
      stats: {
        postsCount: posts.length,
        followingCount: (user.following || []).length,
        followersCount: (user.followers || []).length,
        following: user.following || [],
        followers: user.followers || [],
        isFollowing,
      },
    };
  }

  /**
   * Update Profile data for a user
   */
  async updateProfile(id: string, updateData: Partial<User>) {
    const allowedUpdates: Partial<User> = {};
    if (updateData.firstName !== undefined) allowedUpdates.firstName = updateData.firstName;
    if (updateData.lastName !== undefined) allowedUpdates.lastName = updateData.lastName;
    if (updateData.username !== undefined) allowedUpdates.username = updateData.username;
    if (updateData.avatarUrl !== undefined) allowedUpdates.avatarUrl = updateData.avatarUrl;
    if (updateData.bio !== undefined) allowedUpdates.bio = updateData.bio;
    if (updateData.headline !== undefined) allowedUpdates.headline = updateData.headline;
    if (updateData.location !== undefined) allowedUpdates.location = updateData.location;
    if (updateData.website !== undefined) allowedUpdates.website = updateData.website;
    if (updateData.interests !== undefined) allowedUpdates.interests = updateData.interests;

    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set: allowedUpdates }, { new: true })
      .select(['-password'])
      .exec();

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return updated;
  }

  /**
   * Toggle follow / unfollow for another user or AI Agent
   */
  async toggleFollow(currentUserId: string, targetId: string) {
    if (!currentUserId || !targetId) {
      throw new BadRequestException('currentUserId and targetId are required');
    }

    if (currentUserId === targetId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    const currentUser = await this.userModel.findById(currentUserId).exec();
    if (!currentUser) {
      throw new NotFoundException('Current user not found');
    }

    const following = currentUser.following || [];
    const isAlreadyFollowing = following.includes(targetId);

    if (isAlreadyFollowing) {
      // Unfollow
      await this.userModel.updateOne(
        { _id: currentUserId },
        { $pull: { following: targetId } }
      ).exec();

      // If target is a registered user, remove currentUserId from their followers
      if (Types.ObjectId.isValid(targetId)) {
        await this.userModel.updateOne(
          { _id: targetId },
          { $pull: { followers: currentUserId } }
        ).exec();
      }

      return {
        following: false,
        message: `Unfollowed ${targetId}`,
      };
    } else {
      // Follow
      await this.userModel.updateOne(
        { _id: currentUserId },
        { $addToSet: { following: targetId } }
      ).exec();

      // If target is a registered user, add currentUserId to their followers
      if (Types.ObjectId.isValid(targetId)) {
        await this.userModel.updateOne(
          { _id: targetId },
          { $addToSet: { followers: currentUserId } }
        ).exec();
      }

      return {
        following: true,
        message: `Now following ${targetId}`,
      };
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


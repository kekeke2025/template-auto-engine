import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  Query,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TemplateService } from './template.service';
import { PsdParserService } from './psd-parser.service';
import { CreateTemplateDto } from './dto/create-template.dto';

// PSD上传目录
const PSD_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'psd');
const PSD_EXTRACT_DIR = path.join(process.cwd(), 'uploads', 'psd-extract');
const IMAGE_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'images');

// 确保目录存在
if (!fs.existsSync(PSD_UPLOAD_DIR)) {
  fs.mkdirSync(PSD_UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(PSD_EXTRACT_DIR)) {
  fs.mkdirSync(PSD_EXTRACT_DIR, { recursive: true });
}
if (!fs.existsSync(IMAGE_UPLOAD_DIR)) {
  fs.mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });
}

@Controller('template')
@UseGuards(JwtAuthGuard)
export class TemplateController {
  constructor(
    private readonly templateService: TemplateService,
    private readonly psdParserService: PsdParserService,
  ) {}

  /**
   * 上传PSD文件（仅存储，解析在前端完成）
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, PSD_UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
          const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.psd')) {
          return cb(new BadRequestException('只支持PSD格式文件'), false);
        }
        cb(null, true);
      },
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
      },
    }),
  )
  async uploadPsd(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传PSD文件');
    }

    console.log('PSD文件上传成功:', file.originalname, file.size, 'bytes');

    return {
      code: 0,
      message: '上传成功',
      data: {
        psdUrl: `/uploads/psd/${file.filename}`,
      },
    };
  }

  /**
   * 上传图片（用于替换模板中的图片层）
   */
  @Post('upload/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          cb(null, IMAGE_UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
          const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = /jpg|jpeg|png|gif|webp/i;
        if (!allowedTypes.test(path.extname(file.originalname))) {
          return cb(new BadRequestException('只支持图片格式文件'), false);
        }
        cb(null, true);
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传图片文件');
    }
    return {
      code: 0,
      message: '上传成功',
      data: {
        url: `/uploads/images/${file.filename}`,
        name: file.originalname,
        size: file.size,
      },
    };
  }

  /**
   * 解析PSD文件（通过URL，兼容旧接口）
   */
  @Post('parse')
  async parsePsd(@Body('psdUrl') psdUrl: string) {
    const result = await this.templateService.parsePsd(psdUrl);
    return {
      code: 0,
      message: '解析成功',
      data: result,
    };
  }

  /**
   * 创建模板
   */
  @Post()
  async create(@Request() req, @Body() createTemplateDto: CreateTemplateDto) {
    const template = await this.templateService.create(req.user.id, createTemplateDto);
    return {
      code: 0,
      message: '创建成功',
      data: template,
    };
  }

  /**
   * 获取用户模板列表
   */
  @Get()
  async getList(
    @Request() req,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('category') category?: string,
    @Query('keyword') keyword?: string,
  ) {
    const result = await this.templateService.getUserTemplates(
      req.user.id,
      parseInt(page),
      parseInt(pageSize),
      category,
      keyword,
    );
    return {
      code: 0,
      message: '获取成功',
      data: result,
    };
  }

  /**
   * 获取模板详情
   */
  @Get(':id')
  async getDetail(@Request() req, @Param('id') id: string) {
    const template = await this.templateService.getTemplateDetail(parseInt(id), req.user.id);
    return {
      code: 0,
      message: '获取成功',
      data: template,
    };
  }

  /**
   * 删除模板
   */
  @Delete(':id')
  async delete(@Request() req, @Param('id') id: string) {
    await this.templateService.deleteTemplate(parseInt(id), req.user.id);
    return {
      code: 0,
      message: '删除成功',
    };
  }

  /**
   * 批量生成图片
   */
  @Post(':id/generate')
  async generate(@Request() req, @Param('id') id: string, @Body() body: any) {
    const result = await this.templateService.generateImages(
      parseInt(id),
      req.user.id,
      body.replaceData || {},
      body.sizeNames || [],
    );
    return {
      code: 0,
      message: '生成成功',
      data: result,
    };
  }

  /**
   * 收藏模板
   */
  @Post(':id/favorite')
  async favorite(@Request() req, @Param('id') id: string) {
    await this.templateService.favoriteTemplate(parseInt(id), req.user.id);
    return {
      code: 0,
      message: '收藏成功',
    };
  }

  /**
   * 取消收藏
   */
  @Delete(':id/favorite')
  async unfavorite(@Request() req, @Param('id') id: string) {
    await this.templateService.unfavoriteTemplate(parseInt(id), req.user.id);
    return {
      code: 0,
      message: '取消收藏成功',
    };
  }

  /**
   * 检查是否已收藏
   */
  @Get(':id/favorite/check')
  async checkFavorite(@Request() req, @Param('id') id: string) {
    const result = await this.templateService.checkFavorite(parseInt(id), req.user.id);
    return {
      code: 0,
      message: '获取成功',
      data: result,
    };
  }

  /**
   * 获取收藏列表
   */
  @Get('favorite/list')
  async getFavorites(
    @Request() req,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    const result = await this.templateService.getFavoriteList(
      req.user.id,
      parseInt(page),
      parseInt(pageSize),
    );
    return {
      code: 0,
      message: '获取成功',
      data: result,
    };
  }

  /**
   * 获取生成记录列表
   */
  @Get('record/list')
  async getRecords(
    @Request() req,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    const result = await this.templateService.getGenerateRecords(
      req.user.id,
      parseInt(page),
      parseInt(pageSize),
    );
    return {
      code: 0,
      message: '获取成功',
      data: result,
    };
  }

  /**
   * 获取生成记录详情
   */
  @Get('record/:id')
  async getRecordDetail(@Request() req, @Param('id') id: string) {
    const result = await this.templateService.getGenerateRecordDetail(parseInt(id), req.user.id);
    return {
      code: 0,
      message: '获取成功',
      data: result,
    };
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { PsdParserService } from './psd-parser.service';
import { ImageRenderService } from './image-render.service';
import { FontMatcherService } from './font-matcher.service';
import { LayerStyleService } from './layer-style.service';
import { Template } from './entities/template.entity';
import { TemplateFavorite } from './entities/template-favorite.entity';
import { GenerateRecord } from './entities/generate-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Template, TemplateFavorite, GenerateRecord])],
  controllers: [TemplateController],
  providers: [TemplateService, PsdParserService, ImageRenderService, FontMatcherService, LayerStyleService],
  exports: [TemplateService, PsdParserService, ImageRenderService, FontMatcherService, LayerStyleService],
})
export class TemplateModule {}

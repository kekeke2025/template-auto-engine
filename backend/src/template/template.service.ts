import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { Template } from './entities/template.entity';
import { TemplateFavorite } from './entities/template-favorite.entity';
import { GenerateRecord } from './entities/generate-record.entity';
import { CreateTemplateDto } from './dto/create-template.dto';
import { ImageRenderService, RenderSize } from './image-render.service';

const LAYER_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'layer-images');

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(Template)
    private templateRepository: Repository<Template>,
    @InjectRepository(TemplateFavorite)
    private favoriteRepository: Repository<TemplateFavorite>,
    @InjectRepository(GenerateRecord)
    private generateRecordRepository: Repository<GenerateRecord>,
    private imageRenderService: ImageRenderService,
  ) {
    if (!fs.existsSync(LAYER_IMAGE_DIR)) {
      fs.mkdirSync(LAYER_IMAGE_DIR, { recursive: true });
    }
  }

  /**
   * 创建模板
   */
  async create(userId: number, createTemplateDto: CreateTemplateDto) {
    // 处理主图层图片
    const layers = createTemplateDto.layers || [];
    const processedLayers = await this.processLayerImages(layers);

    // 处理多尺寸变体的图层图片
    let processedVariants: any[] = [];
    if (createTemplateDto.sizeVariants && createTemplateDto.sizeVariants.length > 0) {
      processedVariants = [];
      for (const variant of createTemplateDto.sizeVariants) {
        const variantLayers = variant.layers || [];
        const processedVariantLayers = await this.processLayerImages(variantLayers);
        processedVariants.push({
          ...variant,
          layers: processedVariantLayers,
        });
      }
    }

    // 取第一个尺寸变体作为主尺寸（兼容旧字段）
    const firstVariant = processedVariants[0];
    const mainLayers = processedLayers.length > 0 ? processedLayers : (firstVariant?.layers || []);
    const mainWidth = createTemplateDto.width || firstVariant?.width || 0;
    const mainHeight = createTemplateDto.height || firstVariant?.height || 0;
    const mainPsdUrl = createTemplateDto.psdUrl || firstVariant?.psdUrl || '';
    const mainCover = createTemplateDto.cover || firstVariant?.cover || '';

    // 从 sizeVariants 提取 sizes 列表（兼容旧字段）
    const sizes = (createTemplateDto.sizes && createTemplateDto.sizes.length > 0)
      ? createTemplateDto.sizes
      : processedVariants.map((v: any) => ({ name: v.name, width: v.width, height: v.height }));

    const template = this.templateRepository.create({
      userId,
      ...createTemplateDto,
      psdUrl: mainPsdUrl,
      cover: mainCover,
      width: mainWidth,
      height: mainHeight,
      sizes,
      layers: mainLayers,
      sizeVariants: processedVariants,
      status: 1,
      favoriteCount: 0,
    });
    return this.templateRepository.save(template);
  }

  /**
   * 递归处理图层图片：把 imageData (base64) 转存为文件，替换为 imageUrl
   */
  private async processLayerImages(layers: any[]): Promise<any[]> {
    const result: any[] = [];
    for (const layer of layers) {
      const newLayer = { ...layer };

      // 处理子图层
      if (newLayer.children && newLayer.children.length > 0) {
        newLayer.children = await this.processLayerImages(newLayer.children);
      }

      // 处理当前图层的 imageData
      if (newLayer.imageData && typeof newLayer.imageData === 'string') {
        const imageUrl = await this.saveBase64Image(newLayer.imageData);
        newLayer.imageUrl = imageUrl;
        delete newLayer.imageData; // 不存到数据库，太大
      }

      result.push(newLayer);
    }
    return result;
  }

  /**
   * 保存 base64 图片为文件，返回 URL 路径
   */
  private async saveBase64Image(base64Str: string): Promise<string> {
    const matches = base64Str.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new BadRequestException('无效的图片 base64 格式');
    }
    const ext = matches[1] === 'png' ? 'png' : 'png';
    const data = Buffer.from(matches[2], 'base64');
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    const filePath = path.join(LAYER_IMAGE_DIR, fileName);
    fs.writeFileSync(filePath, data);
    return `/uploads/layer-images/${fileName}`;
  }

  /**
   * 获取用户模板列表
   */
  async getUserTemplates(
    userId: number,
    page: number = 1,
    pageSize: number = 10,
    category?: string,
    keyword?: string,
  ) {
    const query = this.templateRepository
      .createQueryBuilder('t')
      .where('t.userId = :userId', { userId })
      .andWhere('t.status = 1');

    if (category) {
      query.andWhere('t.category = :category', { category });
    }

    if (keyword) {
      query.andWhere('t.name LIKE :keyword', { keyword: `%${keyword}%` });
    }

    query.orderBy('t.createTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await query.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /**
   * 获取模板详情
   */
  async getTemplateDetail(id: number, userId: number) {
    const template = await this.templateRepository.findOne({
      where: { id, status: 1 },
    });
    if (!template) {
      throw new NotFoundException('模板不存在');
    }
    if (template.userId !== userId) {
      throw new BadRequestException('无权限访问该模板');
    }
    return template;
  }

  /**
   * 删除模板
   */
  async deleteTemplate(id: number, userId: number) {
    const template = await this.templateRepository.findOne({
      where: { id, userId },
    });
    if (!template) {
      throw new NotFoundException('无权限删除该模板');
    }
    template.status = 0;
    await this.templateRepository.save(template);
  }

  /**
   * 解析PSD文件（v1.1 接入 psd.js 后替换为真实解析）
   */
  async parsePsd(psdUrl: string) {
    // TODO: v1.1 接入 psd.js 真实解析
    // 临时 Mock，后续替换
    return {
      layers: [
        { id: 1, name: '文字图层1', type: 'text', content: '示例文字', x: 100, y: 100, width: 200, height: 50 },
        { id: 2, name: '图片图层1', type: 'image', url: psdUrl, x: 0, y: 0, width: 800, height: 600 },
      ],
      width: 800,
      height: 600,
    };
  }

  /**
   * 生成图片（支持多尺寸变体，每个尺寸用自己的PSD渲染）
   * @param templateId 模板ID
   * @param userId 用户ID
   * @param replaceData 替换内容（key为图层名，value为替换数据）
   * @param sizeNames 要生成的尺寸名称列表，不传或为空则生成全部尺寸
   */
  async generateImages(
    templateId: number,
    userId: number,
    replaceData: Record<string, any>,
    sizeNames?: string[],
  ) {
    const template = await this.getTemplateDetail(templateId, userId);

    const sizeVariants = (template as any).sizeVariants || [];

    // 兼容旧模板（没有 sizeVariants）：用主 layers + sizes 走缩放方案
    if (!sizeVariants || sizeVariants.length === 0) {
      return this.generateImagesLegacy(template, replaceData, sizeNames);
    }

    // 筛选要生成的目标尺寸
    const targetVariants = sizeVariants.filter((v: any) =>
      !sizeNames || sizeNames.length === 0 || sizeNames.includes(v.name)
    );

    if (targetVariants.length === 0) {
      throw new BadRequestException('未找到匹配的尺寸变体');
    }

    const results: Array<{ sizeName: string; width: number; height: number; url: string; filePath?: string; fileSize?: number }> = [];

    // 逐个渲染每个尺寸变体
    for (const variant of targetVariants) {
      const variantLayers = variant.layers || [];
      const variantWidth = variant.width || 0;
      const variantHeight = variant.height || 0;

      // 将全局 replaceData（按图层名）转换为按 layerId 的格式
      // 前端传的 key 是图层名（因为不同尺寸的 layerId 不一样，但图层名是一致的）
      const variantReplaceContent = this.buildVariantReplaceContent(variantLayers, replaceData);

      // 渲染单张
      const result = await this.imageRenderService.renderSingle(
        variantLayers,
        variantWidth,
        variantHeight,
        variantReplaceContent,
        variant.cover || '',
        { format: 'png', quality: 90 },
      );

      results.push({
        ...result,
        sizeName: variant.name,
      });
    }

    // 生成 ZIP 打包
    let zipUrl = '';
    if (results.length > 1) {
      const taskId = Date.now().toString();
      const zipFileName = `${taskId}_batch.zip`;
      const zipPath = path.join(process.cwd(), 'uploads', 'render', zipFileName);
      zipUrl = `/uploads/render/${zipFileName}`;
      await this.imageRenderService.createZip(results as any, zipPath);
    }

    // 保存生成记录
    const record = this.generateRecordRepository.create({
      userId,
      templateId,
      replaceContent: replaceData,
      results: results.map(r => ({
        sizeName: r.sizeName,
        width: r.width,
        height: r.height,
        url: r.url,
        fileSize: r.fileSize,
      })),
      zipUrl,
      status: 1,
    });
    await this.generateRecordRepository.save(record);

    return {
      images: results,
      zipUrl,
      recordId: record.id,
    };
  }

  /**
   * 为单个尺寸变体构建替换内容（按图层名匹配 → 转换为按 layerId）
   */
  /**
   * 从图层名提取匹配用的关键名称（去掉组名、尺寸等前缀，取最后一段）
   * 例："800x438 / 背景图" → "背景图"
   */
  private getLayerMatchName(name: string): string {
    const parts = name.split(/\/|\\/).map(s => s.trim());
    return parts[parts.length - 1] || name;
  }

  private buildVariantReplaceContent(
    variantLayers: any[],
    replaceData: Record<string, any>,
  ): { texts: any[]; images: any[] } {
    const texts: Array<{ layerId: string; content: string; style?: any }> = [];
    const images: Array<{ layerId: string; url: string }> = [];

    // 扁平化图层方便查找，用匹配名（去掉尺寸/组名前缀）建立索引
    const flatLayers = this.flattenLayers(variantLayers);
    const layerByMatchName = new Map<string, any>();
    for (const layer of flatLayers) {
      if (layer.name) {
        layerByMatchName.set(this.getLayerMatchName(layer.name), layer);
      }
    }

    for (const [matchName, data] of Object.entries(replaceData)) {
      const item = data as any;
      const layer = layerByMatchName.get(matchName);
      if (!layer) continue; // 该尺寸没有这个图层，跳过

      if (item?.type === 'text') {
        texts.push({
          layerId: layer.id,
          content: item.content || '',
          style: item.style || {},
        });
      } else if (item?.type === 'image') {
        images.push({
          layerId: layer.id,
          url: item.url || '',
        });
      }
    }

    return { texts, images };
  }

  /**
   * 扁平化图层树（辅助方法）
   */
  private flattenLayers(layers: any[]): any[] {
    const result: any[] = [];
    for (const layer of layers) {
      if (layer.type === 'group' && layer.children) {
        result.push(...this.flattenLayers(layer.children));
      } else {
        result.push(layer);
      }
    }
    return result;
  }

  /**
   * 旧版生成逻辑（单PSD + 缩放多尺寸，兼容无 sizeVariants 的旧模板）
   */
  private async generateImagesLegacy(
    template: any,
    replaceData: Record<string, any>,
    sizeNames?: string[],
  ) {
    const baseWidth = template.width || 800;
    const baseHeight = template.height || 600;
    const layers = template.layers || [];
    const sizes = template.sizes || [];

    const texts: Array<{ layerId: string; content: string; style?: any }> = [];
    const images: Array<{ layerId: string; url: string }> = [];

    for (const [layerId, data] of Object.entries(replaceData)) {
      const item = data as any;
      if (item?.type === 'text') {
        texts.push({ layerId, content: item.content || '', style: item.style || {} });
        if (item.imageData) {
          const savedPath = await this.saveBase64Image(item.imageData);
          images.push({ layerId, url: savedPath });
        }
      } else if (item?.type === 'image') {
        images.push({ layerId, url: item.url || '' });
      }
    }

    const replaceContent = { texts, images };

    let results: Array<{ sizeName: string; width: number; height: number; url: string; filePath?: string; fileSize?: number }> = [];
    let zipUrl = '';

    const targetSizes = sizes.filter((s: any) =>
      !sizeNames || sizeNames.length === 0 || sizeNames.includes(s.name)
    );

    if (targetSizes && targetSizes.length > 0) {
      const renderResults = await this.imageRenderService.renderBatch(
        layers,
        baseWidth,
        baseHeight,
        targetSizes,
        replaceContent,
        { format: 'png', quality: 90 },
      );
      results = renderResults;

      if (results.length > 1) {
        const taskId = Date.now().toString();
        const zipFileName = `${taskId}_batch.zip`;
        const zipPath = path.join(process.cwd(), 'uploads', 'render', zipFileName);
        zipUrl = `/uploads/render/${zipFileName}`;
        await this.imageRenderService.createZip(results as any, zipPath);
      }
    } else {
      const result = await this.imageRenderService.renderSingle(
        layers,
        baseWidth,
        baseHeight,
        replaceContent,
        template.cover || '',
        { format: 'png', quality: 90 },
      );
      results = [result];
    }

    const record = this.generateRecordRepository.create({
      userId: template.userId,
      templateId: template.id,
      replaceContent: replaceData,
      results: results.map(r => ({
        sizeName: r.sizeName,
        width: r.width,
        height: r.height,
        url: r.url,
        fileSize: r.fileSize,
      })),
      zipUrl,
      status: 1,
    });
    await this.generateRecordRepository.save(record);

    return {
      images: results,
      zipUrl,
      recordId: record.id,
    };
  }

  /**
   * 收藏模板
   */
  async favoriteTemplate(templateId: number, userId: number) {
    const template = await this.templateRepository.findOne({
      where: { id: templateId, status: 1 },
    });
    if (!template) {
      throw new NotFoundException('模板不存在');
    }

    // 检查是否已收藏
    const existing = await this.favoriteRepository.findOne({
      where: { userId, templateId },
    });
    if (existing) {
      throw new BadRequestException('已收藏该模板');
    }

    const favorite = this.favoriteRepository.create({ userId, templateId });
    await this.favoriteRepository.save(favorite);

    // 更新收藏数
    template.favoriteCount = (template.favoriteCount || 0) + 1;
    await this.templateRepository.save(template);

    return { success: true };
  }

  /**
   * 取消收藏
   */
  async unfavoriteTemplate(templateId: number, userId: number) {
    const favorite = await this.favoriteRepository.findOne({
      where: { userId, templateId },
    });
    if (!favorite) {
      throw new BadRequestException('未收藏该模板');
    }

    await this.favoriteRepository.remove(favorite);

    // 更新收藏数
    const template = await this.templateRepository.findOne({
      where: { id: templateId },
    });
    if (template) {
      template.favoriteCount = Math.max(0, (template.favoriteCount || 0) - 1);
      await this.templateRepository.save(template);
    }

    return { success: true };
  }

  /**
   * 检查是否已收藏
   */
  async checkFavorite(templateId: number, userId: number) {
    const favorite = await this.favoriteRepository.findOne({
      where: { userId, templateId },
    });
    return { isFavorite: !!favorite };
  }

  /**
   * 获取收藏列表
   */
  async getFavoriteList(userId: number, page: number = 1, pageSize: number = 10) {
    const query = this.favoriteRepository
      .createQueryBuilder('f')
      .where('f.userId = :userId', { userId })
      .orderBy('f.createTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [favorites, total] = await query.getManyAndCount();

    // 查询模板信息
    const templateIds = favorites.map(f => f.templateId);
    let templates: Template[] = [];
    if (templateIds.length > 0) {
      templates = await this.templateRepository
        .createQueryBuilder('t')
        .where('t.id IN (:...ids)', { ids: templateIds })
        .andWhere('t.status = 1')
        .getMany();
    }

    // 按收藏顺序排序
    const templateMap = new Map(templates.map(t => [t.id, t]));
    const list = favorites
      .map(f => templateMap.get(f.templateId))
      .filter(t => t != null) as Template[];

    return { list, total, page, pageSize };
  }

  /**
   * 获取生成记录列表
   */
  async getGenerateRecords(userId: number, page: number = 1, pageSize: number = 10) {
    const query = this.generateRecordRepository
      .createQueryBuilder('r')
      .where('r.userId = :userId', { userId })
      .orderBy('r.createTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await query.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /**
   * 获取生成记录详情
   */
  async getGenerateRecordDetail(recordId: number, userId: number) {
    const record = await this.generateRecordRepository.findOne({
      where: { id: recordId, userId },
    });
    if (!record) {
      throw new NotFoundException('记录不存在');
    }
    return record;
  }
}

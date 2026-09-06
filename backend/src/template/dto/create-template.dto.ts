import { IsNotEmpty, IsArray, ArrayMinSize, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class SizeDto {
  @IsNotEmpty({ message: '尺寸名称不能为空' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: '宽度不能为空' })
  width: number;

  @IsNotEmpty({ message: '高度不能为空' })
  height: number;
}

class SizeVariantDto {
  @IsNotEmpty({ message: '尺寸名称不能为空' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: '宽度不能为空' })
  width: number;

  @IsNotEmpty({ message: '高度不能为空' })
  height: number;

  @IsNotEmpty({ message: 'PSD文件地址不能为空' })
  @IsString()
  psdUrl: string;

  @IsOptional()
  @IsString()
  cover?: string;

  @IsNotEmpty({ message: '图层信息不能为空' })
  layers: any;
}

export class CreateTemplateDto {
  @IsNotEmpty({ message: '模板名称不能为空' })
  name: string;

  @IsOptional()
  category?: string;

  @IsOptional()
  cover?: string;

  @IsNotEmpty({ message: 'PSD文件地址不能为空' })
  psdUrl: string;

  @IsNotEmpty({ message: '图层信息不能为空' })
  layers: any;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeDto)
  sizes?: SizeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SizeVariantDto)
  sizeVariants?: SizeVariantDto[];

  @IsOptional()
  width?: number;

  @IsOptional()
  height?: number;
}

# 参数化 3D 购物袋 Demo

这是一个 Vite + TypeScript + Three.js 工程，用于展示可交互的参数化 3D 购物袋模型。模型基于 JSON 刀线数据生成，可调整三围尺寸，并支持在展开刀线图上放置图片素材，3D 预览会按同一套展开坐标实时更新。

## 交付内容

- 可运行网页 Demo：`index.html` + `src/` + `public/`
- 源码：TypeScript / CSS / Three.js 建模逻辑
- 刀线数据：`public/data/knife-181.json`
- 纸张与环境素材：`public/assets/`
- README：运行方式、尺寸修改、素材替换、建模思路和当前限制

## 运行

```powershell
npm install
npm run dev
```

启动后打开终端输出的本地地址。项目配置为 `vite --host 127.0.0.1`，默认端口通常是 `5173`；如果端口被占用，Vite 会自动换到下一个可用端口。

## 构建

```powershell
npm run build
```

构建产物输出到 `dist/`。

## 如何修改尺寸

页面左侧提供三组尺寸预设：

- Small: 180 x 230 x 120 mm
- Medium: 240 x 300 x 120 mm
- Large: 310 x 390 x 145 mm

也可以拖动 `Width 宽度`、`Height 高度`、`Gusset 侧宽` 三个滑杆自定义尺寸。

尺寸变化时会动态更新以下关联要素：

- JSON 刀线参数化映射
- 3D 成型模型
- 展开刀线图
- 底部深度和刀线展开宽统计
- 相机观察目标
- 已上传素材在新尺寸刀线上的相对位置和尺寸

## 如何替换素材

1. 在 `贴图侧` 中选择 `外侧` 或 `内侧`。
2. 点击 `替换图片 / logo` 上传 PNG、JPG 或 WebP。
3. 上传后图片会出现在展开刀线图上。
4. 在展开刀线图上拖动图片可调整位置，拖动控制点可缩放，滚轮也可缩放。
5. 右侧 3D 预览会按展开刀线坐标实时更新。

尺寸变化后，素材不会被强行拉伸到新面板尺寸；系统会按旧刀线到新刀线的分段比例迁移素材中心点和素材框尺寸，并保持图片原始宽高比。

## 建模思路

模型以 `public/data/knife-181.json` 为基础刀线，读取其中的 `faces`、`folds` 和 `animation` 数据生成 3D 面片与折叠层级。

- Front panel：JSON 面 `F`，按目标 `Width` 和 `Height` 映射。
- Back panel：JSON 面 `H`，按目标 `Width` 和 `Height` 映射。
- Side gusset：JSON 面 `L` / `R` 及其上下折片，按目标 `Gusset` 映射。
- Bottom structure：底部区域按 `Gusset * 75%` 生成深度，并保留底部折线和三角折片。
- Handle：正背顶部保留刀线中的手提孔结构，随正背面一起成型。
- Glue flap：固定 20 mm 糊纸边。
- Top fold：固定 40 mm 翻折边。

参数化映射按刀线横向和纵向分段完成：

- 横向：糊纸边、背面、左侧风琴、正面、右侧风琴。
- 纵向：顶部翻折边、主体高度、底部结构。

展开刀线编辑器和 3D 模型使用同一套映射后的刀线尺寸，贴图通过全刀线 CanvasTexture 叠加到外侧或内侧 overlay mesh 上。

## 工程结构

```text
src/
  config.ts          尺寸预设、刀线规则和资源路径
  main.ts            应用入口、状态协调、尺寸变化和贴图迁移
  jsonKnifeModel.ts  JSON 刀线解析、参数化映射、Three.js 几何建模和贴图 overlay
  pickInteraction.ts 点击识别面片和高亮反馈
  scene.ts           渲染器、相机、灯光和 OrbitControls
  textures.ts        纸张纹理加载回调
  types.ts           类型定义
  ui.ts              控制面板、展开刀线编辑器和上传交互
  styles.css         页面样式和响应式布局
```

## 当前限制

- 这是面向网页验收的参数化 3D 展示，不是可直接投产的 CAD 刀模文件。
- 底部结构按侧宽 75% 和固定糊纸边表达折叠关系，没有模拟真实纸张碰撞、压痕厚度和物理回弹。
- Handle 当前表现为刀线中的手提孔结构，不包含额外绳带提手。
- 贴图支持拖拽定位和缩放，暂未提供旋转角度编辑控件。
- 贴图面通过 `外侧 / 内侧` 与展开刀线区域确定，不是直接按 `Front / Back / Side` 下拉选择。

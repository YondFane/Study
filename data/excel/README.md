# Excel 词库数据说明

词库中的部分例句可能来自 Tatoeba CC0 或 Princeton WordNet 3.0，来源与授权说明见 `../examples/THIRD_PARTY_NOTICES.md`。发布或复制包含这些例句的词库时必须一并保留该说明。

本目录保存从 `English_Temp` 中 16 个 Excel 文件转换得到的词库，共 8 个分类、37,824 条记录。数据采用 UTF-8 JSON，供 Study 的导航、词库浏览、全局搜索和练习页面按需加载。

## 入口文件

- `index.js`：JavaScript 入口，导出分类信息、数据集信息和异步加载函数。
- `manifest.json`：完整数据清单，包含分类、数据集路径、类型、来源及记录数。
- `search-index.json`：仅包含词条名称的轻量全局搜索索引；选择结果后再加载完整词库。
- 各分类目录：保存实际的 JSON 词库文件。

## 分类和文件

| 分类 | 文件 | 内容 | 记录数 |
| --- | --- | --- | ---: |
| 专八 | `tem8/tem8-vocabulary.json` | 专八词汇 | 5,604 |
| 中考 | `high-school-entrance/junior-high-vocabulary.json` | 初中词汇 | 2,140 |
| 中考 | `high-school-entrance/junior-high-phrases.json` | 初中词组 | 966 |
| 六级 | `cet6/cet6-vocabulary.json` | 六级词汇 | 3,279 |
| 四级 | `cet4/cet4-vocabulary.json` | 四级词汇 | 4,681 |
| 四级 | `cet4/cet4-6-phrases.json` | 四六级词组 | 2,153 |
| 托福 | `toefl/toefl-vocabulary.json` | 托福词汇 | 3,909 |
| 托福 | `toefl/toefl-phrases.json` | 托福词组 | 1,435 |
| 新概念英语 | `new-concept-english/new-concept-1.json` | 第一册词汇 | 908 |
| 新概念英语 | `new-concept-english/new-concept-2.json` | 第二册词汇 | 862 |
| 新概念英语 | `new-concept-english/new-concept-3.json` | 第三册词汇 | 1,062 |
| 新概念英语 | `new-concept-english/new-concept-4.json` | 第四册词汇 | 793 |
| 雅思 | `ielts/ielts-vocabulary.json` | 雅思词汇 | 3,486 |
| 雅思 | `ielts/ielts-phrases.json` | 雅思词组 | 1,267 |
| 高考 | `college-entrance/college-entrance-vocabulary.json` | 高考词汇 | 3,292 |
| 高考 | `college-entrance/high-school-phrases.json` | 高中词组 | 1,987 |

## JSON 字段

每个 JSON 文件都是词条对象数组：

```json
{
  "term": "author",
  "britishPronunciation": "[ˈɔːθə(r)]",
  "americanPronunciation": "[ˈɔːθər]",
  "definition": "n. 作者；作家；创始人",
  "exampleSentence": "The author signed copies of her new book.",
  "exampleTranslation": "这位作者在她的新书上签名。"
}
```

- `term`：单词或词组。
- `britishPronunciation`：英式音标，源数据缺失时为 `null`。
- `americanPronunciation`：美式音标，源数据缺失时为 `null`。
- `definition`：中文释义，多个词性可用换行分隔。
- `exampleSentence`：AI 生成的英文例句；尚未生成时字段不存在。
- `exampleTranslation`：例句的简体中文翻译；尚未生成时字段不存在。

## JavaScript 读取

```js
import { categories, datasets, loadDataset, loadSearchIndex } from './data/excel/index.js'

const cet4Words = await loadDataset('cet4-vocabulary')
const searchIndex = await loadSearchIndex()
console.log(categories, datasets, cet4Words[0], searchIndex.datasets['cet4-vocabulary'][0])
```

`loadDataset(id)` 使用动态导入并在当前页面会话中复用已加载结果，仅在需要时加载对应 JSON。`loadSearchIndex()` 只加载词条名称和词库归属，用于全局快速检索。页面导航先选择考试或课程分类，再通过下拉框选择该分类下的词汇、词组或新概念英语册次；每次只展示和练习一个数据集。

修改词库后运行 `pnpm run generate:search-index` 可重新生成搜索索引；生产构建会在 `prebuild` 阶段自动执行该命令。

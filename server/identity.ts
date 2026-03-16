import { createPRNG } from '../src/engine/prng.js';
import type { Cultivator } from '../src/types.js';
import type { NamedCultivatorRow } from './db.js';
import { getDB, insertNamedCultivator, updateNamedCultivators } from './db.js';

// --- Name Pools (generated from Chinese-Names-Corpus: 120W modern + 25W ancient) ---

const SINGLE_SURNAMES = [
  '李','王','张','刘','陈','杨','黄','吴','周','赵',
  '徐','朱','孙','林','胡','郭','郑','马','何','高',
  '罗','谢','宋','梁','许','蔡','唐','韩','曹','沈',
  '叶','冯','邓','蒋','金','潘','董','彭','曾','于',
  '袁','杜','余','吕','肖','苏','程','魏','丁','田',
  '姚','任','卢','汪','范','崔','姜','钟','陆','方',
  '廖','夏','谭','贾','江','石','邱','邹','白','侯',
  '顾','熊','秦','孟','戴','薛','尹','付','毛','邵',
  '史','钱','郝','万','段','洪','雷','龚','严','陶',
  '汤','施','孔','章','贺','龙','俞','黎','武','温',
];

const COMPOUND_SURNAMES = [
  '慕容','欧阳','上官','司马','诸葛','令狐',
  '东方','西门','南宫','公孙','端木','百里',
  '独孤','皇甫','司徒','宇文','夏侯','纳兰',
  '赫连','轩辕',
];

// Unified surname pool: single + compound, with corpus frequency weights
const ALL_SURNAMES = [...SINGLE_SURNAMES, ...COMPOUND_SURNAMES];
const ALL_SURNAME_WEIGHTS = [
  // Single surname weights (corpus frequency)
  52439,53987,50448,42846,44282,28387,25987,25214,21350,20651,
  19024,17343,16968,16110,15493,14104,13660,13430,12908,11175,
  10866,9629,9424,9116,9013,8227,8227,8137,8019,7928,
  7869,7505,7397,7350,7320,7082,6894,6889,6885,6807,
  6394,6393,6370,6262,6252,6100,6087,6027,5954,5864,
  5822,5657,5632,5459,5363,5323,5293,5232,5162,4964,
  4871,4846,4569,4439,4410,4256,4180,4065,4046,3968,
  3964,3881,3840,3666,3650,3517,3515,3488,3422,3360,
  3343,3267,3197,3158,3128,3023,2982,2913,2913,2769,
  2710,2703,2693,2677,2640,2629,2578,2534,2526,2516,
  // Compound surname weights (corpus frequency, min 1 for 修仙-flavor names)
  46,366,46,93,47,1,
  16,1,2,24,10,1,
  1,33,51,49,37,1,
  2,1,
];

function buildCDF(weights: number[]): number[] {
  const cdf: number[] = [];
  let sum = 0;
  for (const w of weights) { sum += w; cdf.push(sum); }
  for (let i = 0; i < cdf.length; i++) cdf[i] /= sum;
  return cdf;
}

function weightedPick(cdf: number[], r: number): number {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] <= r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const SURNAME_CDF = buildCDF(ALL_SURNAME_WEIGHTS);

// All chars usable as single-char given names
const GIVEN_SINGLES = '丹乾云亦仙修元光兰冰净凌凤初剑华卿君啸坤墨夜天太宁宸寒尘岚岳峰崇幻幽弘弦影忆念怀思恒恬悟慕承无旻昊星昭景暮曦月朝松极枫柏柳桐梅梦楠水沧泉法泽浩海涛清渊溟溪潮澄澜灏火灵烟然煜燕玄玲珏珑琉琳琴琼瑛瑜瑞瑶瑾璃璇璟白皎皓真砚碧禅穹空竹素紫羽翊翎翠翰芷芸苍若茗荷莲菊萧萱蕊薇虚蛟觉谦谧辉辰远逸道醒金锋阳阴雪雷霄霜霞露青静风魂魄鸿鹤鹰麟鼎龙';

// Bigram transition table: first char → string of valid second chars
// Each entry represents corpus-validated character pairings
const BIGRAM: Record<string, string> = {
  '丹': '云元兰冰凤华君宁峰星松枫梅水泉泽海涛清溪灵燕玲琳琴琼瑜瑞瑶芸莲菊蕊薇辉锋阳雪霞露青静风鸿鹤鼎龙',
  '乾': '仙修元光初华君坤峰松泉浩海清皓竹辉道金锋阳鸿麟龙',
  '云': '丹乾仙修元光兰冰凌凤初剑华卿君坤天宁寒岚岳峰影怀恒悟昊星昭景暮曦月朝松枫柏桐梅梦楠水泉法泽浩海涛清溪潮澄澜灏火灵煜燕玲珏琳琴琼瑛瑞瑶白皓真碧竹素羽翊翠翰芸莲菊蕊薇蛟谦辉远逸道金锋阳雪雷霄霜霞露青静风鸿鹤鹰麟鼎龙',
  '亦': '丹云元冰华卿君宁寒岳峰幻松桐梅楠海涛清然玲琳白真羽辉辰锋雪青静风鸿龙',
  '仙': '丹云兰凤华卿君月梅水法灵玲琴真菊蕊辉逸锋霞风鹤鼎龙',
  '修': '云元兰凤剑华卿君坤宁峰思恒星月松柏柳梅法泽浩海涛燕玲琳琴琼禅竹素蛟辉远道金锋阳雷霞静鼎龙',
  '元': '丹乾云仙修光兰凤初华卿君坤夜天太宁宸岳峰崇弘怀思恒承昊星昭景曦月朝松柳梅梦水泉法泽浩海涛清潮澄灏火煜燕玲珏琳琴琼瑛瑜瑞瑶瑾璟白皎皓真碧竹素紫翊翠翰若莲菊薇觉辉辰逸道金锋阳雪霄霜霞青静风鸿鹤麟鼎龙',
  '光': '乾云仙元兰凤初剑华卿君坤天太宁宸寒岳峰崇弘影怀恒承昊星昭景曦月朝松柏桐梅楠水泉法泽浩海涛清渊溪潮澜灵然煜燕玲琳琴琼瑛瑜瑞瑾璇真碧素羽翠翰莲菊蕊谦辉辰远逸道金锋阳雪雷霞露青静风鸿鹤鼎龙',
  '兰': '丹云仙修冰凤华卿君坤天宁岚峰思星景月松梅水泉海涛清溪燕玲琳琴琼瑛瑞真竹紫翠芷芸若菊萱蕊辉金锋雪霞青静',
  '冰': '云仙修兰凌剑华君天寒岚峰星月松梅楠水浩海涛清然燕玲琳琴琼瑜瑶璇竹素芸若莲萱蕊薇辉锋阳雪霜霞青静鸿',
  '净': '思',
  '凌': '云仙光冰凤剑华君墨天宁宸寒尘岚峰松枫梅沧浩海涛烟燕玲琳瑛竹紫翰芸辉辰远锋阳雪雷霄霜霞青静风鸿鹤鹰龙',
  '凤': '丹云仙修元光兰冰凌初华卿君坤宁岚峰影怀景月朝柳桐梅楠水泉海涛清灵然燕玲琳琴琼瑛瑜瑞瑶真禅竹羽翊翎翠翰芸荷莲菊蕊辉辰远金阳雪雷霄霞青静鹤麟鼎龙',
  '初': '丹云元华尘峰桐瑜莲远阳龙',
  '剑': '丹云修元光兰冰凌凤初华卿君啸坤宁寒岚岳峰影星月松梅楠浩海涛清灵然玲琳琴琼白羽芸薇辉锋阳雷霜霞青静风鸿鹰麟龙',
  '华': '丹乾云仙修元光兰冰凌凤初剑卿君坤天太宁岚岳峰影恒恬悟星昭景曦月松枫柏柳梅梦楠水泉法泽浩海涛清渊潮灵然煜燕玲琳琴琼瑜瑞真碧羽翎翠莲菊蕊薇谦辉远道金锋阳雪雷霞露青静风鸿麟龙',
  '卿': '云元华月海然瑜瑞麟龙',
  '君': '乾仙元光兰凌凤初剑华卿坤天太宁峰弘影忆怀恒星昭景朝松梅楠泽浩海涛清渊灵然煜燕玲珏琳琴瑜瑞瑶瑾白碧竹素翠莲蕊薇辉辰远逸道锋阳雪霞青静鸿麟龙',
  '啸': '云仙华君坤天寒尘峰泉海涛灵然风龙',
  '坤': '乾云修元兰凤华君太宁峰恒松梅泉法泽浩海清燕玲琳莲菊辉辰逸金锋阳霞青龙',
  '墨': '仙华卿宁寒然琴白禅菊青',
  '夜': '光冰白羽',
  '天': '乾云元光兰凌凤初剑华卿君啸坤太宁寒岚岳峰忆怀思恒悟承昊星昭月朝松柏梅楠水泉法泽浩海涛清澄澜灏灵然煜燕玄玲珏珑琳琴琼瑜瑞瑶瑾白皓真碧穹竹素羽翊翠若菊薇虚觉谦辉辰远逸道金锋阳雪雷霄霜霞露青静风鸿鹤鹰麟鼎龙',
  '太': '云元光兰凌凤初华君坤宁岚岳峰恒悟旻星月松极梅水海清火灵燕玄玲琴白真素莲菊辉金锋阳雷霞青静龙',
  '宁': '丹云元光兰华君峰忆思星松枫梅泉泽浩海涛燕玲琳瑶羽菊辉远道阳雪霞静',
  '宸': '宁峰昊浩瑜瑞皓翰芸龙',
  '寒': '丹云光冰初峰影星月松枫柏梅涛清燕琼空竹羽辉阳雪霄霜露青风',
  '尘': '风',
  '岚': '兰凤华峰松涛清玲瑛瑶萱青麟',
  '岳': '云仙光兰华卿君峰恒昭松梅浩海清灵玲琴瑞翰辉锋阳雷青龙',
  '峰': '云元光华君宁松梅泉法浩海涛清渊煜燕琳瑞素觉辉远道金阳雪雷霞青',
  '崇': '云仙修元光兰凤剑华卿君坤宁岳峰怀恒悟慕昊昭景柏梅楠泉法浩海涛清渊澄澜烟然燕玄玲琼瑞皓真碧素翠翰莲菊谦辉远逸道金锋阳霄霞静麟鼎龙',
  '幻': '宸弘旻梦',
  '幽': '光兰燕玄',
  '弘': '修元光君坤太宸念昊昭景泉法泽海涛玄瑜璇素远逸道金静鸿',
  '影': '华天月枫梅梦琼辉雪霞',
  '忆': '云兰华卿宁寒影恒梅楠清玲琳琼璇真莲辉青',
  '念': '云修冰华君宁寒峰法泽海涛清琳瑛瑾真芸萱辉辰锋阳霞龙',
  '怀': '云仙元光兰冰凌凤华卿君坤宁岳峰念恒承星月松梅水泽海涛清灏然燕玲珏琳琴琼瑜瑞瑾真素莲菊萱谦远道金锋阳雪霞青静龙',
  '思': '丹乾云元光兰冰净凌凤华卿君坤天宁宸寒岚岳峰崇弘影忆念怀恒悟慕承旻昊昭景月松柳桐梅梦楠水泉法泽浩海涛清渊潮澄灵然燕玄玲琳琴琼瑛瑜瑞瑶瑾璇白皓真碧竹素羽翊翰芸若茗莲菊萱蕊薇谦辉辰远逸道金锋阳雪霞露青静鸿鹤鼎龙',
  '恒': '云元光兰凤华君坤太岳峰星月松梅水泉涛清燕玲瑜瑞真竹菊辉辰远金锋阳霞青风麟龙',
  '恬': '然瑜静',
  '悟': '云光初思海清灵玄真空醒',
  '慕': '云光兰冰初华君天寒岳幽昭松泽清溪然燕玲琴琼瑶瑾白真莲菊金雪青鸿麟龙',
  '承': '乾云仙修元光兰凤初剑华君坤天太宁岳峰思恒昊昭景朝松枫柏梅楠水泉法泽浩海涛清渊灏然煜燕玄玲琳瑛瑜瑞璟皓真素翊翰芸莲萱薇觉谦辉远逸道金锋阳霄霞露静风麟鼎龙',
  '无': '思极梦逸锋',
  '旻': '华君昊昭逸静',
  '昊': '元剑华坤天宁宸峰思承旻星月桐楠泽渊澜然琼翰辰锋阳青龙',
  '星': '丹云元光兰凤初华卿君太尘岳峰恒昊景月松柳梅楠水泉泽浩海涛火然煜燕玲瑞瑶皓竹紫羽翰若莲薇辉辰远逸锋阳雷霞露龙',
  '昭': '乾云元光兰凤华君坤宁宸峰思恒曦月梅楠泉法海涛清渊然燕玄玲琳琴琼瑛瑜瑞璇白素羽若薇觉辉远逸道金锋阳雪霞青鸿麟龙',
  '景': '丹云仙修元光兰凤初华君坤天宁宸寒岚岳峰崇弘思恒恬旻昊星昭曦月朝松枫柏桐梅梦楠水泉泽浩海涛清渊澄澜灏然燕玄玲琳琴琼瑛瑜瑞瑶璇皓真素翊翠苍莲菊萱蕊谦辉辰远逸道金锋阳雪雷霄霞青静风鸿麟龙',
  '曦': '丹云元光华影旻月然煜瑶若辉阳露静龙',
  '月': '丹云仙元光兰冰凌凤初华卿君坤天宁寒岚峰影恒旻星景松梅楠泉浩海涛清溪灵然燕玲琳琴琼瑛瑜瑞瑶白皎竹素翠荷莲菊萱薇辉金锋阳雪雷霞青静龙',
  '朝': '云仙元光兰凌凤初剑华卿君坤天太宁宸峰影恒星曦松梅梦楠水泉泽海涛清澜然煜燕玲珏珑琴琼瑛瑞璇白真碧翰莲菊谦辉远逸金锋阳雪雷霞露青静风鸿麟鼎龙',
  '松': '丹云仙元光兰凌凤华君坤寒岳峰承昊景月柏柳梅楠水泉法泽浩海涛清溪潮澄灵燕玲琳琴瑞真竹翠莲菊觉辉辰远道金锋阳雪雷霞青静风鹤龙',
  '枫': '华楠瑜',
  '柏': '云元光兰初华卿君宁寒峰思昭朝松柳梅楠水泉浩海涛清溪潮灵然玲琴瑛瑜瑞羽翰苍萱谦辉辰金锋雪霄青鸿麟龙',
  '柳': '丹云仙元兰凤华卿君坤宁峰月松梅泉涛清溪燕玲琴琼瑛真碧竹辉金锋霜霞露青静风',
  '桐': '云光华卿松水琴瑞羽翰萱青',
  '梅': '丹云仙兰凤初华卿君天峰影恒星月松楠泉清溪燕玲琳琴琼瑞瑾真竹素莲菊辉金阳雪霞青静鼎龙',
  '梦': '丹云仙修元兰冰凤华卿君坤天宁宸寒尘岚弘影思恬星曦月松极桐梅楠水泉泽浩海涛清溪潮灵烟然煜燕玲珏琳琴琼瑛瑜瑞瑶瑾璇白真碧禅竹羽芸若荷莲菊萱蕊薇蛟觉谦辉辰远醒金阳雪雷霜霞露青静鸿鹤麟鼎龙',
  '楠': '华君坤清燕辉阳霞',
  '水': '云仙元光兰冰凤华卿君坤峰影恬星月松柏柳梅泉法泽浩涛清潮火灵燕玲琴瑶莲菊辉金锋阳霞青静鸿龙',
  '沧': '海霞龙',
  '泉': '云元凤华君峰月水海清溪灵玲皓真辉逸道金锋龙',
  '法': '乾云修元光兰华坤天宁崇弘念恒悟昭朝松水泉泽浩海清澄然玲琳真空菊觉辉远道金雷静鹤麟龙',
  '泽': '丹乾云修元光兰冰凌凤剑华卿君坤天宁峰弘怀恒承昊星昭曦朝松枫桐梅楠水泉法浩海涛清渊溪然煜燕玲琳琴琼瑜瑞璇莲萱薇蛟谦辉辰远金锋阳雷霞青静风鸿鹰麟龙',
  '浩': '丹乾云亦修元光初华卿君坤墨天宁宸寒岚岳峰恒星月松枫桐梅楠泉泽海涛清渊溟澄澜然煜燕玲琳琼瑜瑞白真羽若谦辉辰远逸金锋阳雷霞青静风龙',
  '海': '丹乾云仙元光兰冰凌凤初剑华卿君啸坤天宁岚岳峰影怀思恒星昭景曦月朝松枫柏柳桐梅梦楠水沧泉法泽浩涛清渊潮澄澜灵然煜燕玲琳琴琼瑛瑜瑞瑶瑾璇真碧空素翎翠芸苍若莲菊萱薇蛟觉辉辰远逸道金锋阳雪雷霄霞露青静风鸿鹤鹰麟龙',
  '涛': '云华峰松海清瑞远锋',
  '清': '乾云修元光兰冰凌凤华卿君坤太宁尘岚峰影念怀恒慕旻景曦月朝松柏梅梦水泉法泽浩海涛渊溪澜烟然燕玄玲琳琴琼瑜瑞瑶璇白皎皓真碧竹素羽翠翰若莲菊薇觉辉远逸道金锋阳雪霞露青静风鸿麟龙',
  '渊': '华松泉泽浩涛然辉龙',
  '溟': '浩碧',
  '溪': '云光华卿月枫楠水泉泽浩涛清澄然瑶芸觉逸鹤',
  '潮': '华峰海瑛辉金阳',
  '澄': '元兰天曦月楠浩海清澜灵真碧素远阳静鹤',
  '澜': '昊涛澄燕',
  '灏': '岚然翰锋',
  '火': '仙元兰凤华星松梅泉法清烟燕玲真莲辉金青龙',
  '灵': '丹云仙修光冰凤华君岚峰幽昭月梅泉海涛溪燕玲琳琴瑞真空竹素翰芸薇觉辉锋阳霄霜霞静风麟龙',
  '烟': '霞',
  '然': '冰华峰松',
  '煜': '云初华坤宸峰弦昊星曦枫浩清澄灵然琳茗辉锋阳龙',
  '燕': '丹云仙元光兰冰凌凤初华卿君坤宁峰思星昭月松枫柳梅楠海涛清灵然玲琳琴琼瑜瑾璇皎真紫羽翎翠芸莲菊薇辉金锋阳雪雷霞青静风鸿鹰麟龙',
  '玄': '光初华卿峰崇悟承昭景曦松法清澄灵珏瑞瑾真竹素菊觉逸道霜青静风龙',
  '玲': '丹云仙修兰凤华君岳峰月梅清灵燕珏珑琳琴琼瑛瑜瑶素羽翠菊辉锋雪霞青静风龙',
  '珏': '华玲琴琼瑞瑾',
  '琳': '丹云仙元凤华君峰曦月梅楠清燕玲琼瑛瑜瑶瑾皓萱辉雪霞青静鸿',
  '琴': '丹云仙修兰凤华君思梅燕玲琳瑶辉霞',
  '琼': '丹云仙元兰凤初华君天峰星月梅海清燕玲珑琳瑛瑜瑶莲菊辉霞静龙',
  '瑛': '兰冰华峰梅楠珏琳瑞瑶辉逸锋鸿',
  '瑜': '元光华君峰梅玲琳琴琼瑛瑶瑾璇真辉雪霞青静',
  '瑞': '丹乾云仙元光兰冰凤初华卿君坤天宁宸岳峰弘怀恒承星昭景月朝松枫柏桐梅楠水泉法泽浩海涛清溪潮澄澜灵烟然煜燕玲珏琳琴琼瑛瑜瑶瑾璇真碧竹芸莲菊萱谦辉辰远金锋阳雪雷霜霞青静风鸿鹤麟鼎龙',
  '瑶': '云仙光冰华卿君星清玲琴琼瑛瑜竹萱辉辰青静',
  '瑾': '光冰初华宁浩琳瑜瑶璇萱',
  '璇': '华卿君梅泽海涛玲',
  '璟': '卿燕',
  '白': '丹云元光兰冰凤华君尘峰梅水泉涛清渊然燕玲皎羽翎莲菊萱薇觉金阳雪霜霞露鹤麟龙',
  '皎': '月然琳',
  '皓': '云元冰华天太宸峰星月枫楠然琳瑜瑞若谦阳雪麟龙',
  '真': '云仙修元光兰凤华卿君宁崇怀悟梅海清然玄玲琴瑞白空素觉辉逸金阳静龙',
  '砚': '华君泉海清辉青龙',
  '碧': '丹云仙元光兰凤初华卿君天岚峰弘影月松柳梅楠水泉海涛清溪澄灵燕玲琳琴琼瑜瑶璇真砚空翠翰芸荷莲薇辉金锋雪霄霞青静鸿麟龙',
  '空': '云修华幻悟海瑜荷辉道',
  '竹': '乾云仙兰凤初华卿君天峰影承月松梅泉涛清溪燕玲琳琴瑞素翠薇虚逸霞青静风',
  '素': '丹乾云仙修兰冰凤华卿君坤宁峰影星月梅涛清灵烟然燕玲琳琴琼瑛瑜瑶白真碧芷芸荷莲菊萱蕊辉金锋阳雪雷霞青静风',
  '紫': '丹云仙元光兰冰凌凤初剑华卿君墨宸寒峰恒星景曦月桐梅梦楠涛清溪烟然煜燕玲琳琴琼瑜瑞瑶璇真竹羽芸莲菊萱薇辉逸金阳霄霜霞青静龙',
  '羽': '乾仙凌凤华君啸坤墨天宸峰影枫桐梅楠泽清然燕玲白翰薇辰锋霞青麟龙',
  '翊': '丹云元凤华君宁宸峰枫清羽萱金青龙',
  '翠': '丹云仙兰冰凤华君宁岚峰影景月松柏柳梅海涛清灵然燕玲琳琴琼瑛瑜瑶真碧竹羽芸莲菊薇辉金锋雪霄霞青静风龙',
  '翰': '仙元光华卿君坤宁昭涛清灵锋阳青',
  '芷': '云兰冰华君宁寒月清溪玲琳瑜瑶璇竹芸若萱薇青',
  '芸': '华君燕瑞竹紫萱薇辉锋霞',
  '苍': '松水龙',
  '若': '丹云仙元光兰冰凤初华卿君坤天宁宸寒尘岚峰弘思星昭景曦松柏柳桐梅梦楠水泉海涛清溪潮澄澜灵然燕玲琳琴琼瑛瑜瑶瑾璇璟真竹羽翰芷芸莲菊萱薇虚辉辰金锋阳雪霞青静风鸿鹰麟龙',
  '茗': '元月煜璇辉',
  '荷': '云仙兰凤桐清琴莲蕊阳青',
  '莲': '云仙凤华卿君枫梅清琴素菊霞青',
  '菊': '云仙元兰凤初华君影梅泉清渊燕玲琴琼瑛莲蕊辉逸金霞青',
  '萧': '华君然玲远',
  '蕊': '修华君峰梅玲琳羽',
  '薇': '元华君玲瑛羽静',
  '虚': '白',
  '蛟': '青麟龙',
  '觉': '元初华宁月海清澄然玄真空辉逸道',
  '谦': '光初华峰锋',
  '辉': '云元光兰凤华君宁峰星松梅泉泽海涛清灵然燕玲琴琼碧辰远道金锋阳霞鸿龙',
  '辰': '云光兰初华君宸岳峰昊星松泽浩涛清燕瑶辉阳霞龙',
  '远': '云修光兰冰凤剑华君坤宁峰思恒昊星昭景曦月松枫梅楠泉法泽浩海涛清燕玲琴琼瑛碧翠莲菊辉逸道金锋阳雪霞青静风鸿龙',
  '逸': '丹云仙元冰华卿君坤天宁宸寒尘岚峰恒松枫梅梦楠浩涛清然琳琴璇萱辉辰锋阳雪青静风鸿鹤麟龙',
  '道': '乾云仙修元光兰凤初华卿君坤宁岳峰崇幽弘思恒悟承旻星昭景月朝松柳楠水泉法泽海涛清渊溪澄澜然燕玄玲琳琴琼瑜瑞瑾白皎真空素莲菊萱觉谦辉辰远逸金锋阳雪雷霞青静风鸿麟龙',
  '醒': '光华尘龙',
  '金': '丹乾云仙元光兰凌凤初剑华卿君坤天太宁岳峰影怀恒承昊星昭景月朝松柏柳桐梅梦楠水泉法泽浩海涛清溪潮澜火灵然煜燕玲琳琴琼瑜瑞瑶瑾璇真碧竹素紫羽翠翰芸苍莲菊蕊薇觉辉辰远逸道锋阳雪雷霞露青静风鸿鹤鹰麟鼎龙',
  '锋': '云光兰华君浩涛燕辉雷',
  '阳': '丹云修元光兰冰凤初华卿君坤天太宁峰悟昊星月朝松梅楠泉泽海清溪燕玄珏琳琴瑛瑜瑾璟皓辉远道金雪霞青静鸿麟鼎龙',
  '雪': '丹云仙元光兰冰净凌凤初剑华卿君坤夜宁寒尘岚岳峰影怀思悟无昭景曦月松枫柏柳桐梅楠水泉法浩海涛清渊溪潮灵然燕玲琳琴琼瑛瑜瑞瑶瑾璇皎真碧竹羽翎翠芸莲菊蕊薇辉辰逸道金锋阳雷霜霞露青静风鸿鹤鹰麟龙',
  '雷': '云光华卿君星泉涛澄瑛辉锋阳龙',
  '霄': '云凌剑坤峰月松楠燕琳羽阳雪雷霞鸿鹤龙',
  '霜': '华月梅琳雪',
  '霞': '丹云仙光兰凤华卿君梅清然燕玲琳琴芸菊辉青静龙',
  '露': '丹云元华君岚峰思曦月梅楠水泉清燕玲琳琴琼瑶真禅芸茗薇锋阳霞青',
  '青': '丹云元光兰凤华卿君天宁岳峰昊月松柏柳桐梅楠水泉泽浩海涛清烟燕玲琳瑶璇砚竹翠芷芸荷莲菊蛟辉辰远金锋阳雪雷霄霜霞静风鹤麟龙',
  '静': '丹云修元兰冰凤初华卿君坤宁岚峰影念思恬旻曦月松柳梅楠泉海涛清渊溪澄澜然燕玄玲琳琴琼瑛瑜瑞瑶璇真竹羽芸莲菊萱蕊薇觉辉远逸锋阳雪雷霄霞露风龙',
  '风': '云仙元光兰剑华卿君坤宁岚影景朝梅泉海涛清然燕玲琴琼瑞白真竹翠荷莲菊辉远金雪雷霞青静龙',
  '鸿': '云仙修元光兰冰初剑华卿君坤宁峰影恒星月柏梅楠泉泽浩海涛清渊潮然煜燕玲琳琴琼瑜瑞羽翊翎翰莲菊辉远逸道金锋阳雷霄霞静鹰麟鼎龙',
  '鹤': '云仙凌凤君宁峰影松梅楠泉清然玄玲琳琴瑞真素羽翎远逸阳露麟龙',
  '麟': '元光华卿君昭曦然瑞辉',
  '鼎': '云元光华卿坤天宁峰思恒承朝梅瑞皓辉金阳龙',
  '龙': '丹云仙元光凤剑华卿君坤天太峰崇恒昊星梅水泉法泽浩海涛清溪燕玲琴琼瑞真竹羽翰芸莲菊辉金锋阳雪霄霞青静风麟',
};
const FIRST_CHARS = Object.keys(BIGRAM);

const NAME_SEED_XOR = 0x4E414D45;
const MAX_RETRY = 100;
const SUFFIX_CHARS = '②③④⑤⑥⑦⑧⑨⑩';

// --- NamedCultivator ---

export interface NamedCultivator {
  id: number;
  name: string;
  namedAtYear: number;
  killCount: number;
  combatWins: number;
  combatLosses: number;
  promotionYears: { year: number; toLevel: number }[];
  peakLevel: number;
  peakCultivation: number;
  deathYear?: number;
  deathCause?: 'combat' | 'expiry' | 'tribulation' | 'ascension';
  killedBy?: string;
}

function rowToNamedCultivator(row: NamedCultivatorRow): NamedCultivator {
  return {
    id: row.id,
    name: row.name,
    namedAtYear: row.named_at_year,
    killCount: row.kill_count,
    combatWins: row.combat_wins,
    combatLosses: row.combat_losses,
    promotionYears: JSON.parse(row.promotion_years),
    peakLevel: row.peak_level,
    peakCultivation: row.peak_cultivation,
    deathYear: row.death_year ?? undefined,
    deathCause: (row.death_cause as NamedCultivator['deathCause']) ?? undefined,
    killedBy: row.killed_by ?? undefined,
  };
}

// --- IdentityManager ---

export class IdentityManager {
  private active = new Map<number, NamedCultivator>();
  private usedNames = new Set<string>();
  private dirty = new Set<number>();
  private pendingInserts: NamedCultivator[] = [];
  private namePrng: () => number;

  constructor(seed: number) {
    this.namePrng = createPRNG(seed ^ NAME_SEED_XOR);
  }

  rebuildFromDB(): void {
    const db = getDB();
    const names = db.prepare('SELECT name FROM named_cultivators').all() as { name: string }[];
    for (const r of names) this.usedNames.add(r.name);

    const alive = db.prepare(
      'SELECT * FROM named_cultivators WHERE death_year IS NULL'
    ).all() as NamedCultivatorRow[];
    for (const row of alive) this.active.set(row.id, rowToNamedCultivator(row));
  }

  generateName(): string {
    for (let i = 0; i < MAX_RETRY; i++) {
      const name = this.rawName();
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name;
      }
    }
    const base = this.rawName();
    for (let i = 0; i < SUFFIX_CHARS.length; i++) {
      const name = base + SUFFIX_CHARS[i];
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name;
      }
    }
    const fallback = base + '⑪';
    this.usedNames.add(fallback);
    return fallback;
  }

  private rawName(): string {
    const p = this.namePrng;
    const surname = ALL_SURNAMES[weightedPick(SURNAME_CDF, p())];
    if (p() < 0.3) {
      // 30%: single-char given name
      return surname + GIVEN_SINGLES[Math.floor(p() * GIVEN_SINGLES.length)];
    }
    // 70%: two-char given name via bigram model
    const first = FIRST_CHARS[Math.floor(p() * FIRST_CHARS.length)];
    const successors = BIGRAM[first];
    const second = successors[Math.floor(p() * successors.length)];
    return surname + first + second;
  }

  onPromotion(c: Cultivator, toLevel: number, year: number): void {
    const nc = this.active.get(c.id);
    if (nc) {
      nc.promotionYears.push({ year, toLevel });
      if (toLevel > nc.peakLevel) nc.peakLevel = toLevel;
      if (c.cultivation > nc.peakCultivation) nc.peakCultivation = c.cultivation;
      this.dirty.add(c.id);
      return;
    }
    if (toLevel < 2) return;
    const name = this.generateName();
    const newNc: NamedCultivator = {
      id: c.id,
      name,
      namedAtYear: year,
      killCount: 0,
      combatWins: 0,
      combatLosses: 0,
      promotionYears: [{ year, toLevel }],
      peakLevel: toLevel,
      peakCultivation: c.cultivation,
    };
    this.active.set(c.id, newNc);
    this.pendingInserts.push(newNc);
  }

  onCombatResult(
    winner: Cultivator,
    loser: Cultivator,
    loserDied: boolean,
    year: number,
  ): void {
    const w = this.active.get(winner.id);
    if (w) {
      w.combatWins++;
      if (loserDied) w.killCount++;
      if (winner.cultivation > w.peakCultivation) w.peakCultivation = winner.cultivation;
      this.dirty.add(winner.id);
    }
    const l = this.active.get(loser.id);
    if (l) {
      l.combatLosses++;
      if (loserDied) {
        l.deathYear = year;
        l.deathCause = 'combat';
        l.killedBy = w ? w.name : '无名修士';
      }
      this.dirty.add(loser.id);
    }
  }

  onExpiry(c: Cultivator, year: number): void {
    const nc = this.active.get(c.id);
    if (!nc) return;
    nc.deathYear = year;
    nc.deathCause = 'expiry';
    this.dirty.add(c.id);
  }

  onTribulation(c: Cultivator, outcome: 'ascension' | 'death', year: number): void {
    const nc = this.active.get(c.id);
    if (!nc) return;
    nc.deathYear = year;
    nc.deathCause = outcome === 'ascension' ? 'ascension' : 'tribulation';
    this.dirty.add(c.id);
  }

  flushToDB(): void {
    if (!this.pendingInserts.length && !this.dirty.size) return;

    const inserts = this.pendingInserts.splice(0);
    const dirtyIds = [...this.dirty];
    this.dirty.clear();

    const updates: Parameters<typeof updateNamedCultivators>[0] = [];
    for (const id of dirtyIds) {
      const nc = this.active.get(id);
      if (!nc) continue;
      updates.push({
        id: nc.id,
        killCount: nc.killCount,
        combatWins: nc.combatWins,
        combatLosses: nc.combatLosses,
        promotionYears: JSON.stringify(nc.promotionYears),
        peakLevel: nc.peakLevel,
        peakCultivation: nc.peakCultivation,
        deathYear: nc.deathYear,
        deathCause: nc.deathCause,
        killedBy: nc.killedBy,
      });
    }

    getDB().transaction(() => {
      for (const nc of inserts) {
        insertNamedCultivator({
          id: nc.id,
          name: nc.name,
          namedAtYear: nc.namedAtYear,
          peakLevel: nc.peakLevel,
          peakCultivation: nc.peakCultivation,
          promotionYears: JSON.stringify(nc.promotionYears),
        });
      }
      if (updates.length) updateNamedCultivators(updates);
    })();

    for (const [id, nc] of this.active) {
      if (nc.deathYear !== undefined) this.active.delete(id);
    }
  }

  getActive(id: number): NamedCultivator | undefined {
    return this.active.get(id);
  }

  get activeCount(): number {
    return this.active.size;
  }

  reset(seed: number): void {
    this.active.clear();
    this.usedNames.clear();
    this.dirty.clear();
    this.pendingInserts.length = 0;
    this.namePrng = createPRNG(seed ^ NAME_SEED_XOR);
  }
}

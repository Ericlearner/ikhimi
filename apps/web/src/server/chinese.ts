/**
 * Traditional → simplified Chinese for answer checking (学习 = 學習), on the server only: the table is too large
 * for students' phones. Imported for its effect by every module that grades answers.
 */
import * as OpenCC from 'opencc-js/t2cn'
import { setChineseConverter } from '@ikhimi/ai'

setChineseConverter(OpenCC.Converter({ from: 't', to: 'cn' }))

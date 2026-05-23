/**
 * ESM 桥接（仅服务端：API Route / Server Component）
 * 客户端请使用 lib/track-category-client.js
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const filters = require("./track-filters.cjs");

export const BLUE_LIST_KEYWORDS = filters.BLUE_LIST_KEYWORDS;
export const TRACK_CATEGORIES = filters.TRACK_CATEGORIES;
export const TRACK_CATEGORY_LIST = filters.TRACK_CATEGORY_LIST;
export const DIFY_CLASSIFICATION_GUIDE = filters.DIFY_CLASSIFICATION_GUIDE;
export const passesBlueListGate = filters.passesBlueListGate;
export const titlePassesBlueList = filters.titlePassesBlueList;
export const logBlueListRejected = filters.logBlueListRejected;
export const normalizeTrackCategory = filters.normalizeTrackCategory;

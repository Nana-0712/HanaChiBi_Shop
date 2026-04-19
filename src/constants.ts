export interface Product {
  id: number | string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  category: string;
  subCategory?: string;
  brand?: string;
  isHot?: boolean;
  isNew?: boolean;
  isFlashSale?: boolean;
  soldCount?: number;
  totalStock?: number;
  rating?: number;
  reviews?: number;
  description?: string;
}

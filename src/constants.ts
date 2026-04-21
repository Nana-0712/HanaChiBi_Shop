export interface ProductOption {
  name: string; // e.g., "Màu sắc", "Kích thước"
  values: string[]; // e.g., ["Hồng", "Xanh", "Vàng"]
  images?: Record<string, string>; // mapping value to image URL
}

export interface Review {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
  images?: string[];
}

export interface Product {
  id: number | string;
  name: string;
  price: number;
  originalPrice?: number;
  image: string;
  images?: string[];
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
  details?: string;
  options?: ProductOption[];
  minQuantity?: number;
  purchaseMode?: 'quantity' | 'combo';
  combos?: number[]; // e.g., [5, 10, 20]
  reviewsList?: Review[];
  createdAt?: string; 
}

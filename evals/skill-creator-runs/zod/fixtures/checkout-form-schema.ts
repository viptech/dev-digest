import { z } from 'zod';

const AddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  postalCode: z.string().min(3).max(12),
  country: z.string().length(2),
});

export const CheckoutFormSchema = z.object({
  email: z.string(),
  fullName: z.string().min(1).max(120),
  shippingAddress: AddressSchema,
  billingAddress: AddressSchema.optional(),
  sameAsShipping: z.boolean().default(true),
  promoCode: z.string().max(24).optional(),
  cardLastFour: z.string().length(4),
}).refine((data) => {
  if (!data.sameAsShipping && !data.billingAddress) {
    throw new Error('Billing address is required when it differs from shipping');
  }
  return true;
}, { message: 'Billing address is required when it differs from shipping' });

export interface CheckoutForm {
  email: string;
  fullName: string;
  shippingAddress: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
  billingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
  sameAsShipping: boolean;
  promoCode?: string;
  cardLastFour: string;
}

export function validateCheckoutForm(payload: unknown): CheckoutForm {
  return CheckoutFormSchema.parse(payload);
}

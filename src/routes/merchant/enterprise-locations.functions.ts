import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, getAuthenticatedUserId } from "@/lib/auth/middleware";
import { createEnterpriseLocation, listEnterpriseLocations, transferEnterpriseInventory, receiveEnterpriseInventoryTransfer, type EnterpriseLocationRow } from "@/lib/market/enterprise-multilocation.server";

const merchantId=z.string().trim().min(1).max(128);
const locationType=z.enum(["store","warehouse","distribution_center","fulfillment_center","pickup_point","office","service_center"]);

export const loadEnterpriseLocations=createServerFn({method:"GET"}).middleware([authMiddleware]).validator(z.object({merchantId})).handler(async({data,context}): Promise<EnterpriseLocationRow[]> => listEnterpriseLocations(data.merchantId,getAuthenticatedUserId(context)));

export const createEnterpriseLocationFn=createServerFn({method:"POST"}).middleware([authMiddleware]).validator(z.object({merchantId,name:z.string().trim().min(2).max(160),address:z.string().trim().min(4).max(400),city:z.string().trim().min(2).max(120),countryCode:z.string().trim().length(2).optional(),locationType,externalLocationKey:z.string().trim().min(1).max(160).optional(),latitude:z.number().finite().min(-90).max(90).optional(),longitude:z.number().finite().min(-180).max(180).optional(),timezone:z.string().trim().min(1).max(80).optional()})).handler(async({data,context})=>createEnterpriseLocation({...data,userId:getAuthenticatedUserId(context)}));

export const requestEnterpriseInventoryTransfer=createServerFn({method:"POST"}).middleware([authMiddleware]).validator(z.object({merchantId,productId:z.string().min(1).max(128),fromLocationId:z.string().min(1).max(128),toLocationId:z.string().min(1).max(128),quantity:z.number().int().min(1).max(1000000),idempotencyKey:z.string().min(16).max(128)})).handler(async({data,context})=>transferEnterpriseInventory({...data,userId:getAuthenticatedUserId(context)}));

export const receiveEnterpriseInventoryTransferFn=createServerFn({method:"POST"}).middleware([authMiddleware]).validator(z.object({merchantId,transferId:z.string().min(1).max(128)})).handler(async({data,context})=>receiveEnterpriseInventoryTransfer({...data,userId:getAuthenticatedUserId(context)}));

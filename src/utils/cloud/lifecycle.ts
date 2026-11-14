import 'server-only'

export type DeliveryStatus='prepared'|'accepted'|'dispatching'|'unknown'|'rejected'|'sent'|'delivered'|'read'|'failed'
const rank:Partial<Record<DeliveryStatus,number>>={prepared:0,dispatching:1,unknown:1,rejected:1,accepted:2,failed:3,sent:4,delivered:5,read:6}
export function nextDeliveryStatus(current:DeliveryStatus,incoming:'sent'|'delivered'|'read'|'failed'):DeliveryStatus {
 // A late failure cannot erase a confirmed send/delivery/read. Signed status
 // callbacks can resolve unknown outcomes; receipt time does not define order.
 return (rank[incoming]??0)>(rank[current]??0)?incoming:current
}
export function serviceWindowOpen(lastCustomerAt:string,now=Date.now()) {
 const last=Date.parse(lastCustomerAt)
 return Number.isFinite(last)&&last<=now+300000&&last>now-24*3600000
}

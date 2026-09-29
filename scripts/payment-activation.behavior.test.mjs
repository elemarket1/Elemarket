import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePaymentActivation} from './configure-payment-providers.mjs';
const environment={ELEMARKET_ENV:'staging',ELEMARKET_SETTLEMENT_MODE:'provider_direct_uncontrolled',ELEMARKET_PAYMENT_PROVIDERS:'processor',ELEMARKET_PAYMENT_PROCESSOR_DRIVER:'paystack',ELEMARKET_PAYMENT_PROCESSOR_SECRET:'synthetic'};
const config=[{providerKey:'processor',name:'Processor',method:'card'}];
test('payment activation is explicit, capability checked and never confers settlement capability',()=>{
 const [entry]=validatePaymentActivation(config,environment);assert.equal(entry.driverKey,'paystack');assert.equal(entry.capabilities.deliveryDisputeHold,false);
 assert.doesNotThrow(()=>validatePaymentActivation(config,{...environment,ELEMARKET_ENV:'production'}));
 assert.throws(()=>validatePaymentActivation(config,{...environment,ELEMARKET_PAYMENT_PROCESSOR_SECRET:''}),/missing configuration/);
 for(const driver of ['hubtel','http','constructor','../../module'])assert.throws(()=>validatePaymentActivation(config,{...environment,ELEMARKET_PAYMENT_PROCESSOR_DRIVER:driver}));
 for(const invalid of [[],[...config,...config],[{...config[0],method:'crypto'}],[{...config[0],capabilities:{deliveryDisputeHold:true}}]])assert.throws(()=>validatePaymentActivation(invalid,environment));
});

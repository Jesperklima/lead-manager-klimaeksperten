// Unknown is different from a withdrawal. Only explicit booleans grant contact permission.
export function contactConsent(value:unknown):boolean|null {
  if(value===true||value===false)return value;
  if(typeof value==='string'){
    const normalized=value.trim().toLowerCase();
    if(normalized==='true')return true;
    if(normalized==='false')return false;
  }
  return null;
}
export function contactState(previous:any,consent:boolean|null,eventId:string,connectionId:string,at:string){
  const metadata={...(previous?.metadata||{})};
  if(consent!==null){
    const evidence={value:consent,event_id:eventId,connection_id:connectionId,recorded_at:at,scope:'response_to_inbound_request'};
    metadata.contact_consent=evidence;
    metadata.contact_consent_history=[...(Array.isArray(metadata.contact_consent_history)?metadata.contact_consent_history:[]),evidence].slice(-20);
  }
  return {
    consent_to_contact:consent===null?previous?.consent_to_contact===true:consent,
    contact_basis:consent===false?null:(previous?.contact_basis||(consent===true?'explicit_inbound_request':null)),
    metadata
  };
}

import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

/** Angular marca como inseguro todo href que no sea http(s)/mailto/tel; el
 * intent de WhatsApp Business (intent://…package=com.whatsapp.w4b) se permite
 * solo si tiene exactamente esa forma. Cualquier otra URL pasa sin tocar. */
@Pipe({ name: 'wa' })
export class WaPipe implements PipeTransform {
  private san = inject(DomSanitizer);
  transform(url: string | null | undefined): SafeUrl | string | null {
    if (url && /^intent:\/\/send\/\?phone=\d+[^#]*#Intent;scheme=whatsapp;package=com\.whatsapp\.w4b;/.test(url)) {
      return this.san.bypassSecurityTrustUrl(url);
    }
    return url ?? null;
  }
}

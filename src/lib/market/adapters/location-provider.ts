export type GeocodedLocation = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  countryCode?: string;
  confidence?: number;
  providerPlaceId?: string;
};

export interface LocationProvider {
  readonly key: string;
  readonly attribution: ReadonlyArray<{ label: string; href: string }>;
  geocode(address: string): Promise<GeocodedLocation>;
  reverseGeocode(lat: number, lon: number): Promise<GeocodedLocation>;
}


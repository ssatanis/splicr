/**
 * Real HGNC gene symbols, used so the sample screens read naturally.
 *
 * Symbols only, never nicknames: AIFM2 rather than FSP1, because HGNC assigns
 * FSP1 to S100A4 and a reader who looks one up has to land on the right gene.
 */
export const GENE_POOL = [
  "RPL3", "RPL5", "RPL7", "RPL11", "RPS3", "RPS6", "RPS19", "RPS27A", "POLR2A", "POLR2B", "PCNA", "RAN",
  "SUPT5H", "SUPT6H", "CDK1", "CDK9", "PLK1", "AURKB", "KIF11", "TOP2A", "RRM1", "RRM2", "PSMA1", "PSMB5",
  "PSMD1", "EIF4A3", "EIF3A", "SF3B1", "SNRNP200", "PRPF8", "U2AF2", "NUP93", "NUP205", "RUVBL1", "RUVBL2",
  "ATR", "CHEK1", "WEE1", "MCM2", "MCM7", "CDC45", "GINS2", "ORC1", "DNMT1", "UHRF1", "KAT2A", "EP300",
  "BRD4", "MYC", "MAX", "MTOR", "RPTOR", "RICTOR", "AKT1", "PIK3CA", "PTEN", "TP53", "MDM2", "CDKN1A",
  "KRAS", "NRAS", "BRAF", "MAPK1", "MAP2K1", "EGFR", "ERBB2", "MET", "FGFR1", "IGF1R", "SHOC2", "RAF1",
  "CCND1", "CDK4", "CDK6", "RB1", "E2F1", "SKP2", "CDC20", "ANAPC4", "FZR1", "BUB1B", "MAD2L1", "TTK",
  "ATM", "BRCA1", "BRCA2", "PALB2", "RAD51", "XRCC1", "PARP1", "LIG1", "FEN1", "POLD1", "POLE", "RFC2",
  "SLC7A11", "GPX4", "AIFM2", "ACSL4", "NFE2L2", "KEAP1", "HMOX1", "TXNRD1", "SOD1", "SOD2", "CAT", "PRDX1",
  "STAT3", "JAK1", "JAK2", "IL6ST", "SOCS3", "IRF1", "IFNGR1", "IFNGR2", "B2M", "TAP1", "TAP2", "HLA-A",
  "PTPN2", "ADAR", "CD274", "PDCD1", "CTLA4", "LAG3", "TIGIT", "CD47", "SIRPA", "APLNR", "PTPN11", "CBL",
  "SMARCA4", "SMARCB1", "ARID1A", "ARID1B", "KDM6A", "KMT2D", "EZH2", "SUZ12", "EED", "DOT1L", "MEN1", "KMT2A",
  "BCL2", "MCL1", "BCL2L1", "BAX", "BAK1", "CASP3", "CASP8", "CASP9", "APAF1", "CYCS", "XIAP", "BIRC5",
  "VHL", "HIF1A", "EPAS1", "ARNT", "EGLN1", "ELOB", "ELOC", "CUL2", "RBX1", "NEDD8", "UBA3", "NAE1",
  "SLC2A1", "HK2", "PKM", "LDHA", "PDK1", "IDH1", "IDH2", "SDHB", "FH", "OGDH", "DLD", "PDHA1",
  "GAPDH", "ACTB", "TUBB", "HSP90AB1", "HSPA8", "CCT2", "CCT8", "TCP1", "VCP", "UBE2I", "SAE1", "UBA2",
  "TEAD1", "YAP1", "WWTR1", "NF2", "LATS1", "LATS2", "STK11", "MOB1A", "SAV1", "AMOTL2", "VGLL4", "TEAD4",
  "ZEB1", "SNAI1", "TWIST1", "CDH1", "VIM", "FN1", "ITGB1", "ILK", "PTK2", "SRC", "CRK", "PXN",
  "SLFN11", "ATRX", "DAXX", "SETD2", "BAP1", "PBRM1", "KDM5C", "NF1", "SPRED1", "RASA1", "DUSP4", "DUSP6",
  "WRN", "BLM", "RECQL4", "POLQ", "RAD52", "USP1", "WDR48", "FANCD2", "FANCA", "SLX4", "MUS81", "EME1",
  "MYCN", "AURKA", "TRIM28", "ZNF143", "SETDB1", "ATF4", "DDIT3", "EIF2AK3", "ERN1", "XBP1", "HSPA5", "CALR",
  "PPP2CA", "PPP2R1A", "PPP1CA", "PPP1R15A", "PPM1D", "CDC25A", "CDC25B", "CDC25C", "NEK2", "PBK", "MELK", "PRKDC",
];

/**
 * Real MGI mouse symbols, for the mouse sample screen.
 *
 * A separate list rather than a title-case transform of the human one. Most
 * mouse orthologues are the human symbol in title case, but enough are not that
 * a transform would have printed symbols that do not exist: TP53 is Trp53, FH is
 * Fh1, AIFM2 is Aifm2, and HLA-A has no mouse orthologue at all, so H2-K1
 * stands in its place.
 */
export const MOUSE_GENE_POOL = [
  "Cdk1", "Cdk9", "Plk1", "Aurkb", "Kif11", "Top2a", "Rrm1", "Rrm2", "Psma1", "Psmb5", "Psmd1", "Eif4a3",
  "Eif3a", "Sf3b1", "Snrnp200", "Prpf8", "U2af2", "Nup93", "Nup205", "Ruvbl1", "Ruvbl2", "Atr", "Chek1", "Wee1",
  "Mcm2", "Mcm7", "Cdc45", "Gins2", "Orc1", "Dnmt1", "Uhrf1", "Kat2a", "Ep300", "Brd4", "Myc", "Max",
  "Mtor", "Rptor", "Rictor", "Akt1", "Pik3ca", "Pten", "Trp53", "Mdm2", "Cdkn1a", "Kras", "Nras", "Braf",
  "Mapk1", "Map2k1", "Egfr", "Erbb2", "Met", "Fgfr1", "Igf1r", "Shoc2", "Raf1", "Ccnd1", "Cdk4", "Cdk6",
  "Rb1", "E2f1", "Skp2", "Cdc20", "Anapc4", "Fzr1", "Bub1b", "Mad2l1", "Ttk", "Atm", "Brca1", "Brca2",
  "Palb2", "Rad51", "Xrcc1", "Parp1", "Lig1", "Fen1", "Pold1", "Pole", "Rfc2", "Slc7a11", "Gpx4", "Aifm2",
  "Acsl4", "Nfe2l2", "Keap1", "Hmox1", "Txnrd1", "Sod1", "Sod2", "Cat", "Prdx1", "Stat3", "Jak1", "Jak2",
  "Il6st", "Socs3", "Irf1", "Ifngr1", "Ifngr2", "B2m", "Tap1", "Tap2", "H2-K1", "Ptpn2", "Adar", "Cd274",
  "Pdcd1", "Ctla4", "Lag3", "Tigit", "Cd47", "Sirpa", "Aplnr", "Ptpn11", "Cbl", "Smarca4", "Smarcb1", "Arid1a",
  "Arid1b", "Kdm6a", "Kmt2d", "Ezh2", "Suz12", "Eed", "Dot1l", "Men1", "Kmt2a", "Bcl2", "Mcl1", "Bcl2l1",
  "Bax", "Bak1", "Casp3", "Casp8", "Casp9", "Apaf1", "Cycs", "Xiap", "Birc5", "Vhl", "Hif1a", "Epas1",
  "Arnt", "Egln1", "Elob", "Eloc", "Cul2", "Rbx1", "Nedd8", "Uba3", "Nae1", "Slc2a1", "Hk2", "Pkm",
  "Ldha", "Pdk1", "Idh1", "Idh2", "Sdhb", "Fh1", "Ogdh", "Dld", "Pdha1", "Mycn", "Aurka", "Trim28",
  "Zfp143", "Setdb1", "Atf4", "Ddit3", "Eif2ak3", "Ern1", "Xbp1", "Hspa5", "Calr", "Ppp2ca", "Ppp1ca", "Prkdc",
];

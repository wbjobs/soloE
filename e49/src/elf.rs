use crate::error::{Result, SymConflictError};
use crate::symbol::{Symbol, SymbolType};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

const ELF_MAGIC: [u8; 4] = [0x7f, b'E', b'L', b'F'];
const ELFCLASS32: u8 = 1;
const ELFCLASS64: u8 = 2;

const SHT_DYNSYM: u32 = 11;
const SHT_GNU_versym: u32 = 0x6fffffff;
const SHT_GNU_verdef: u32 = 0x6ffffffd;
const SHT_GNU_verneed: u32 = 0x6ffffffe;
const SHT_STRTAB: u32 = 3;

const STB_WEAK: u8 = 2;
const STB_GLOBAL: u8 = 1;
const STB_LOCAL: u8 = 0;

const STT_FUNC: u8 = 2;
const STT_OBJECT: u8 = 1;
const STT_NOTYPE: u8 = 0;

const VER_FLG_BASE: u16 = 0x1;
const VER_NDX_HIDDEN: u16 = 0x8000;
const VER_NDX_LOCAL: u16 = 0;
const VER_NDX_GLOBAL: u16 = 1;

#[derive(Debug, Clone)]
pub struct VersionInfo {
    pub version: u16,
    pub name: String,
    pub filename: String,
    pub is_hidden: bool,
    pub is_base: bool,
}

pub struct ElfParser {
    data: Vec<u8>,
    is_64bit: bool,
    endian_little: bool,
}

impl ElfParser {
    pub fn new(path: &Path) -> Result<Self> {
        let mut file = File::open(path)?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)?;

        if data.len() < 64 {
            return Err(SymConflictError::InvalidFile(
                "File too small to be ELF".to_string(),
            ));
        }

        if data[0..4] != ELF_MAGIC {
            return Err(SymConflictError::InvalidFile(
                "Not an ELF file".to_string(),
            ));
        }

        let class = data[4];
        let is_64bit = match class {
            ELFCLASS32 => false,
            ELFCLASS64 => true,
            _ => {
                return Err(SymConflictError::InvalidFile(format!(
                    "Unknown ELF class: {}",
                    class
                )))
            }
        };

        let endian_little = data[5] == 1;

        Ok(ElfParser {
            data,
            is_64bit,
            endian_little,
        })
    }

    fn read_u16(&self, offset: usize) -> u16 {
        if self.endian_little {
            u16::from_le_bytes([self.data[offset], self.data[offset + 1]])
        } else {
            u16::from_be_bytes([self.data[offset], self.data[offset + 1]])
        }
    }

    fn read_u32(&self, offset: usize) -> u32 {
        if self.endian_little {
            u32::from_le_bytes([
                self.data[offset],
                self.data[offset + 1],
                self.data[offset + 2],
                self.data[offset + 3],
            ])
        } else {
            u32::from_be_bytes([
                self.data[offset],
                self.data[offset + 1],
                self.data[offset + 2],
                self.data[offset + 3],
            ])
        }
    }

    fn read_u64(&self, offset: usize) -> u64 {
        if self.endian_little {
            u64::from_le_bytes([
                self.data[offset],
                self.data[offset + 1],
                self.data[offset + 2],
                self.data[offset + 3],
                self.data[offset + 4],
                self.data[offset + 5],
                self.data[offset + 6],
                self.data[offset + 7],
            ])
        } else {
            u64::from_be_bytes([
                self.data[offset],
                self.data[offset + 1],
                self.data[offset + 2],
                self.data[offset + 3],
                self.data[offset + 4],
                self.data[offset + 5],
                self.data[offset + 6],
                self.data[offset + 7],
            ])
        }
    }

    fn read_word(&self, offset: usize) -> u64 {
        if self.is_64bit {
            self.read_u64(offset)
        } else {
            self.read_u32(offset) as u64
        }
    }

    fn read_string(&self, offset: usize) -> String {
        let mut result = String::new();
        let mut i = offset;
        while i < self.data.len() && self.data[i] != 0 {
            result.push(self.data[i] as char);
            i += 1;
        }
        result
    }

    fn get_section_headers(&self) -> Vec<SectionHeader> {
        let e_shoff = if self.is_64bit {
            self.read_u64(0x28) as usize
        } else {
            self.read_u32(0x20) as usize
        };

        let e_shentsize = if self.is_64bit {
            self.read_u16(0x36) as usize
        } else {
            self.read_u16(0x2e) as usize
        };

        let e_shnum = if self.is_64bit {
            self.read_u16(0x38)
        } else {
            self.read_u16(0x30)
        };

        let mut sections = Vec::new();

        for i in 0..e_shnum {
            let offset = e_shoff + i as usize * e_shentsize;
            let sh = if self.is_64bit {
                SectionHeader {
                    sh_name: self.read_u32(offset),
                    sh_type: self.read_u32(offset + 4),
                    sh_flags: self.read_u64(offset + 8),
                    sh_addr: self.read_u64(offset + 16),
                    sh_offset: self.read_u64(offset + 24),
                    sh_size: self.read_u64(offset + 32),
                    sh_link: self.read_u32(offset + 40),
                    sh_info: self.read_u32(offset + 44),
                    sh_addralign: self.read_u64(offset + 48),
                    sh_entsize: self.read_u64(offset + 56),
                }
            } else {
                SectionHeader {
                    sh_name: self.read_u32(offset),
                    sh_type: self.read_u32(offset + 4),
                    sh_flags: self.read_u32(offset + 8) as u64,
                    sh_addr: self.read_u32(offset + 12) as u64,
                    sh_offset: self.read_u32(offset + 16) as u64,
                    sh_size: self.read_u32(offset + 20) as u64,
                    sh_link: self.read_u32(offset + 24),
                    sh_info: self.read_u32(offset + 28),
                    sh_addralign: self.read_u32(offset + 32) as u64,
                    sh_entsize: self.read_u32(offset + 36) as u64,
                }
            };
            sections.push(sh);
        }

        sections
    }

    fn get_shstrtab(&self, sections: &[SectionHeader]) -> String {
        if sections.is_empty() {
            return String::new();
        }

        let e_shstrndx = if self.is_64bit {
            self.read_u16(0x3a) as usize
        } else {
            self.read_u16(0x32) as usize
        };

        if e_shstrndx >= sections.len() {
            return String::new();
        }

        let shstrtab_sh = &sections[e_shstrndx];
        let offset = shstrtab_sh.sh_offset as usize;
        let size = shstrtab_sh.sh_size as usize;

        let mut result = String::new();
        for i in 0..size {
            if offset + i < self.data.len() {
                let b = self.data[offset + i];
                if b == 0 {
                    result.push('\0');
                } else {
                    result.push(b as char);
                }
            }
        }
        result
    }

    pub fn extract_dynamic_symbols(&self, library_path: &Path) -> Result<Vec<Symbol>> {
        let sections = self.get_section_headers();
        let shstrtab = self.get_shstrtab(&sections);

        let mut dynsym_sh = None;
        let mut dynstr_sh = None;
        let mut versym_sh = None;
        let mut verneed_sh = None;
        let mut verdef_sh = None;

        for sh in &sections {
            let name_offset = sh.sh_name as usize;
            let name = shstrtab
                .split('\0')
                .nth(name_offset / 2)
                .unwrap_or("")
                .to_string();

            match sh.sh_type {
                SHT_DYNSYM => {
                    dynsym_sh = Some(sh);
                    let linked_idx = sh.sh_link as usize;
                    if linked_idx < sections.len() {
                        dynstr_sh = Some(&sections[linked_idx]);
                    }
                }
                SHT_GNU_versym => {
                    versym_sh = Some(sh);
                }
                SHT_GNU_verneed => {
                    verneed_sh = Some(sh);
                }
                SHT_GNU_verdef => {
                    verdef_sh = Some(sh);
                }
                _ => {}
            }
        }

        let dynsym_sh = match dynsym_sh {
            Some(sh) => sh,
            None => return Err(SymConflictError::ParseError("No .dynsym section found".to_string())),
        };

        let dynstr_sh = match dynstr_sh {
            Some(sh) => sh,
            None => return Err(SymConflictError::ParseError("No .dynstr section found".to_string())),
        };

        let mut version_map = HashMap::new();

        if let Some(vs) = verdef_sh {
            self.parse_verdef(vs, &shstrtab, &mut version_map)?;
        }

        if let Some(vn) = verneed_sh {
            self.parse_verneed(vn, &shstrtab, &mut version_map)?;
        }

        let mut symbols = Vec::new();
        let entsize = dynsym_sh.sh_entsize as usize;
        let num_symbols = if entsize > 0 {
            dynsym_sh.sh_size as usize / entsize
        } else {
            0
        };

        let lib_name = library_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        for i in 0..num_symbols {
            let sym_offset = dynsym_sh.sh_offset as usize + i * entsize;

            let (st_name, st_info, st_shndx, st_value) = if self.is_64bit {
                let name = self.read_u32(sym_offset);
                let info = self.data[sym_offset + 4];
                let shndx = self.read_u16(sym_offset + 6);
                let value = self.read_u64(sym_offset + 8);
                (name, info, shndx, value)
            } else {
                let name = self.read_u32(sym_offset);
                let value = self.read_u32(sym_offset + 4) as u64;
                let shndx = self.read_u16(sym_offset + 10);
                let info = self.data[sym_offset + 12];
                (name, info, shndx, value)
            };

            let bind = (st_info >> 4) & 0xf;
            let stype = st_info & 0xf;

            if st_shndx == 0 {
                continue;
            }

            let name_offset = st_name as usize;
            let mut name = if name_offset > 0 && (dynstr_sh.sh_offset + name_offset as u64) < self.data.len() as u64 {
                self.read_string(dynstr_sh.sh_offset as usize + name_offset)
            } else {
                String::new()
            };

            if name.is_empty() {
                continue;
            }

            let mut version = None;
            if let Some(vs) = versym_sh {
                let versym_offset = vs.sh_offset as usize + i * 2;
                if versym_offset + 2 <= self.data.len() {
                    let versym = self.read_u16(versym_offset);
                    let ver_ndx = versym & !VER_NDX_HIDDEN;
                    let is_hidden = (versym & VER_NDX_HIDDEN) != 0;

                    if !is_hidden && ver_ndx > VER_NDX_GLOBAL {
                        if let Some(ver_info) = version_map.get(&ver_ndx) {
                            name = format!("{}@{}", name, ver_info.name);
                            version = Some(ver_info.clone());
                        }
                    }
                }
            }

            let is_global = bind == STB_GLOBAL || bind == STB_WEAK;
            let is_weak = bind == STB_WEAK;

            let symbol_type = match stype {
                STT_FUNC => {
                    if is_weak {
                        SymbolType::WeakFunction
                    } else {
                        SymbolType::Function
                    }
                }
                STT_OBJECT => {
                    if is_weak {
                        SymbolType::WeakVariable
                    } else {
                        SymbolType::GlobalVariable
                    }
                }
                _ => SymbolType::Other,
            };

            if !name.starts_with("__cxa") && !name.starts_with("__gxx") {
                symbols.push(Symbol {
                    name,
                    symbol_type,
                    library: library_path.to_path_buf(),
                    library_name: lib_name.clone(),
                    address: format!("{:x}", st_value),
                    is_global,
                    is_weak,
                });
            }
        }

        Ok(symbols)
    }

    fn parse_verdef(
        &self,
        sh: &SectionHeader,
        shstrtab: &str,
        version_map: &mut HashMap<u16, VersionInfo>,
    ) -> Result<()> {
        let mut offset = sh.sh_offset as usize;
        let end = offset + sh.sh_size as usize;

        while offset + 20 <= end {
            let vd_version = self.read_u16(offset);
            let vd_flags = self.read_u16(offset + 2);
            let vd_ndx = self.read_u16(offset + 4);
            let vd_cnt = self.read_u16(offset + 6);
            let vd_hash = self.read_u32(offset + 8);
            let vd_aux = self.read_u32(offset + 12);
            let vd_next = self.read_u32(offset + 16);

            if vd_cnt > 0 {
                let mut aux_offset = offset + vd_aux as usize;
                for _ in 0..vd_cnt {
                    if aux_offset + 8 <= end {
                        let vda_name = self.read_u32(aux_offset);
                        let vda_next = self.read_u32(aux_offset + 4);

                        let name = self.get_string_from_shstrtab(shstrtab, vda_name as usize);

                        version_map.insert(
                            vd_ndx,
                            VersionInfo {
                                version: vd_ndx,
                                name: name.clone(),
                                filename: name,
                                is_hidden: false,
                                is_base: (vd_flags & VER_FLG_BASE) != 0,
                            },
                        );

                        if vda_next == 0 {
                            break;
                        }
                        aux_offset += vda_next as usize;
                    }
                }
            }

            if vd_next == 0 {
                break;
            }
            offset += vd_next as usize;
        }

        Ok(())
    }

    fn parse_verneed(
        &self,
        sh: &SectionHeader,
        shstrtab: &str,
        version_map: &mut HashMap<u16, VersionInfo>,
    ) -> Result<()> {
        let mut offset = sh.sh_offset as usize;
        let end = offset + sh.sh_size as usize;

        while offset + 16 <= end {
            let vn_version = self.read_u16(offset);
            let vn_cnt = self.read_u16(offset + 2);
            let vn_file = self.read_u32(offset + 4);
            let vn_aux = self.read_u32(offset + 8);
            let vn_next = self.read_u32(offset + 12);

            let filename = self.get_string_from_shstrtab(shstrtab, vn_file as usize);

            if vn_cnt > 0 {
                let mut aux_offset = offset + vn_aux as usize;
                for _ in 0..vn_cnt {
                    if aux_offset + 16 <= end {
                        let vna_hash = self.read_u32(aux_offset);
                        let vna_flags = self.read_u16(aux_offset + 4);
                        let vna_other = self.read_u16(aux_offset + 6);
                        let vna_name = self.read_u32(aux_offset + 8);
                        let vna_next = self.read_u32(aux_offset + 12);

                        let name = self.get_string_from_shstrtab(shstrtab, vna_name as usize);

                        version_map.insert(
                            vna_other,
                            VersionInfo {
                                version: vna_other,
                                name: name.clone(),
                                filename: filename.clone(),
                                is_hidden: false,
                                is_base: false,
                            },
                        );

                        if vna_next == 0 {
                            break;
                        }
                        aux_offset += vna_next as usize;
                    }
                }
            }

            if vn_next == 0 {
                break;
            }
            offset += vn_next as usize;
        }

        Ok(())
    }

    fn get_string_from_shstrtab(&self, shstrtab: &str, offset: usize) -> String {
        let mut result = String::new();
        let mut i = 0;
        for c in shstrtab.chars().skip(offset) {
            if c == '\0' {
                break;
            }
            result.push(c);
            i += 1;
        }
        result
    }
}

#[derive(Debug)]
struct SectionHeader {
    sh_name: u32,
    sh_type: u32,
    sh_flags: u64,
    sh_addr: u64,
    sh_offset: u64,
    sh_size: u64,
    sh_link: u32,
    sh_info: u32,
    sh_addralign: u64,
    sh_entsize: u64,
}

pub fn is_elf_file(path: &Path) -> bool {
    match File::open(path) {
        Ok(mut file) => {
            let mut magic = [0u8; 4];
            match file.read_exact(&mut magic) {
                Ok(_) => magic == ELF_MAGIC,
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

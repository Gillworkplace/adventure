#pragma once
#include <sstream>
// Independent training loader: immutable B/Phi/T/exact singletons; only GA changes.
struct Compact {
 static uint64_t nextRevision(){static std::atomic<uint64_t> seq{0};return ++seq;}
 uint64_t revision=nextRevision(); Codec codec;
 std::vector<std::array<int,23>>add;std::vector<std::array<int16_t,16>>sub;
 int R=100,Q=0,K=0,TG=0;bool quant=true,exact=false;
 std::vector<float>B,T,A,PHI,GT,GA;std::vector<int16_t>AQ,PQ,GQ,SINGLE;
 float as=1,ps=1,gs=1;int horizon()const{return R;}
 explicit Compact(const std::string&path){
  std::ifstream f(path,std::ios::binary);int h[8];f.read((char*)h,32);
  if(!f||(h[0]!=0x56435332&&h[0]!=0x56435333)||h[1]!=100||h[2]!=N+1||h[3]!=0||h[4]<1||h[4]>256||h[5]<1||h[7]!=0)throw std::runtime_error("training requires Q0 S32/S33 K<=256");
  exact=h[0]==0x56435333;K=h[4];TG=h[5];if(h[6]!=(exact?1:0))throw std::runtime_error("anchor flag");
  auto fp=[&](auto&v,size_t n){v.resize(n);if(n)f.read((char*)v.data(),n*sizeof(v[0]));};
  fp(B,size_t(101)*2*(N+1));if(exact)fp(SINGLE,B.size()*22);
  f.read((char*)&as,4);f.read((char*)&ps,4);fp(PQ,size_t(80730)*K);fp(GT,101*TG);f.read((char*)&gs,4);fp(GQ,size_t(2)*(N+1)*K*TG);
  if(!f||f.peek()!=std::char_traits<char>::eof())throw std::runtime_error("training model length");
  PHI.resize(PQ.size());for(size_t i=0;i<PQ.size();i++)PHI[i]=PQ[i]*ps;
  add.resize(14950);sub.resize(80730);int c[5]={},ix=0;
  auto gen=[&](auto&&self,int pos,int n,int low)->void{if(pos<n){for(int x=low;x<=22;x++){c[pos]=x;self(self,pos+1,n,x);}return;}sub[ix].fill(-1);for(int j=0;j<n;j++)sub[ix][j]=c[j]-1;if(n<5)for(int x=1;x<=22;x++){int a[5];std::copy(c,c+n,a);a[n]=x;std::sort(a,a+n+1);add[ix][x]=codec.rank(a,n+1);}++ix;};for(int n=0;n<=5;n++)gen(gen,0,n,1);
 }
 void dequant(){if(!quant)return;GA.resize(GQ.size());for(size_t i=0;i<GA.size();i++)GA[i]=GQ[i]*gs;quant=false;++revision;}
 double leaf(const State&s)const{if(s.terminal())return s.p;int r=100-s.t,n=__builtin_popcount(s.deck);double sum=0;uint32_t bits=s.deck;while(bits){int id=__builtin_ctz(bits)+1;bits&=bits-1;sum+=DECK_COEFF[codec.idmap[id]];}return val(r,s.b,s.p,codec.hand(s),s.n)+.6*std::min(1.,.7*(r+s.b)/n)*sum;}
 double val(int r,int b,int p,int h,int n)const{
  if(!r&&!b)return p;int x=b*(N+1)+p,row=r*2*(N+1)+x;double v=B[row];if(!n)return v;
  if(exact)for(int i=0;i<n;i++)v+=SINGLE[size_t(row)*22+sub[h][i]]/32.;
  struct Row{int tag=-1;float f[256];};static thread_local std::vector<Row>rows(2048);static thread_local const Compact*owner=nullptr;static thread_local uint64_t rev=~uint64_t(0);
  if(owner!=this||rev!=revision){for(auto&z:rows)z.tag=-1;owner=this;rev=revision;}
  auto&z=rows[(uint32_t(row)*2654435761u)&2047];if(z.tag!=row){z.tag=row;for(int k=0;k<K;k++){double y=0;for(int j=0;j<TG;j++){size_t a=(size_t(x)*K+k)*TG+j;y+=GT[r*TG+j]*(quant?GQ[a]*gs:GA[a]);}z.f[k]=y;}}
  for(int k=0;k<K;k++)v+=PHI[size_t(h)*K+k]*z.f[k];return v;
 }
 void save(const std::string&path)const{
  if(quant)throw std::runtime_error("save expects dequantized GA");std::ofstream f(path,std::ios::binary);if(!f)throw std::runtime_error("save open");int h[]={exact?0x56435333:0x56435332,100,N+1,0,K,TG,exact?1:0,0};f.write((char*)h,32);
  auto wr=[&](auto&v){if(!v.empty())f.write((char*)v.data(),v.size()*sizeof(v[0]));};wr(B);if(exact)wr(SINGLE);f.write((char*)&as,4);f.write((char*)&ps,4);wr(PQ);wr(GT);
  // Preserve the original scale; trust-region updates cannot silently rescale every coefficient.
  f.write((char*)&gs,4);for(float x:GA){double q=std::nearbyint(x/gs);if(q< -32767||q>32767)throw std::runtime_error("quantization saturation");int16_t z=int16_t(q);f.write((char*)&z,2);}if(!f)throw std::runtime_error("save truncated");
 }
};
